package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io/ioutil"
	"log"
	"net/http"

	"github.com/gorilla/websocket"
	"golang.org/x/crypto/ssh"
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true },
}

type WsMessage struct {
	Event    string `json:"event"`
	ServerID string `json:"serverId,omitempty"`
	LogID    string `json:"logId,omitempty"`
	Data     string `json:"data,omitempty"`
}

func handleWebSocket(w http.ResponseWriter, r *http.Request) {
	token := r.URL.Query().Get("token")
	if !verifyToken(token) {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Println("Upgrade error:", err)
		return
	}
	// We handle close explicitly depending on context

	var sshClient *ssh.Client
	var sshSession *ssh.Session

	cleanupSSH := func() {
		if sshSession != nil {
			sshSession.Close()
		}
		if sshClient != nil {
			sshClient.Close()
		}
	}

	defer func() {
		cleanupSSH()
		conn.Close()
	}()

	for {
		_, msgData, err := conn.ReadMessage()
		if err != nil {
			break // Client disconnected
		}

		var msg WsMessage
		if err := json.Unmarshal(msgData, &msg); err != nil {
			continue
		}

		if msg.Event == "start-stream" {
			// Clean up previous stream if any
			cleanupSSH()

			var targetServer *Server
			for _, s := range AppConfig.Servers {
				if s.ID == msg.ServerID {
					targetServer = &s
					break
				}
			}

			if targetServer == nil {
				sendWsError(conn, "Server not found")
				continue
			}

			var targetLog *LogFile
			for _, l := range targetServer.LogFiles {
				if l.ID == msg.LogID {
					targetLog = &l
					break
				}
			}

			if targetLog == nil {
				sendWsError(conn, "Log not found")
				continue
			}

			sendWsInfo(conn, fmt.Sprintf("Successfully connected to %s...", targetServer.Name))

			// Start tail process in goroutine so we can keep reading websocket messages
			go startTail(conn, targetServer, targetLog, &sshClient, &sshSession)
		}
	}
}

func sendWsError(conn *websocket.Conn, errStr string) {
	conn.WriteJSON(WsMessage{Event: "log-error", Data: errStr})
}

func sendWsInfo(conn *websocket.Conn, infoStr string) {
	conn.WriteJSON(WsMessage{Event: "log-info", Data: infoStr})
}

func startTail(conn *websocket.Conn, server *Server, logFile *LogFile, clientPtr **ssh.Client, sessionPtr **ssh.Session) {
	config := &ssh.ClientConfig{
		User: server.Username,
		Auth: []ssh.AuthMethod{},
		HostKeyCallback: ssh.InsecureIgnoreHostKey(),
	}

	if server.AuthType == "privateKey" {
		key, err := ioutil.ReadFile(server.PrivateKeyPath)
		if err != nil {
			sendWsError(conn, "Failed to load private key")
			return
		}
		signer, err := ssh.ParsePrivateKey(key)
		if err != nil {
			sendWsError(conn, "Invalid private key format")
			return
		}
		config.Auth = append(config.Auth, ssh.PublicKeys(signer))
	} else {
		config.Auth = append(config.Auth, ssh.Password(server.Password))
	}

	addr := fmt.Sprintf("%s:%d", server.Host, server.Port)
	if server.Port == 0 {
		addr = fmt.Sprintf("%s:22", server.Host)
	}

	client, err := ssh.Dial("tcp", addr, config)
	if err != nil {
		sendWsError(conn, fmt.Sprintf("SSH Dial Error: %v", err))
		return
	}
	*clientPtr = client

	session, err := client.NewSession()
	if err != nil {
		sendWsError(conn, fmt.Sprintf("SSH Session Error: %v", err))
		return
	}
	*sessionPtr = session

	stdout, err := session.StdoutPipe()
	if err != nil {
		sendWsError(conn, fmt.Sprintf("Stdout pipe error: %v", err))
		return
	}
	
	stderr, err := session.StderrPipe()
	if err != nil {
		sendWsError(conn, fmt.Sprintf("Stderr pipe error: %v", err))
		return
	}

	go func() {
		scanner := bufio.NewScanner(stderr)
		for scanner.Scan() {
			sendWsError(conn, scanner.Text())
		}
	}()

	cmd := fmt.Sprintf("tail -n 100 -f %s", logFile.Path)
	if err := session.Start(cmd); err != nil {
		sendWsError(conn, fmt.Sprintf("Command error: %v", err))
		return
	}

	scanner := bufio.NewScanner(stdout)
	for scanner.Scan() {
		conn.WriteJSON(WsMessage{Event: "log-data", Data: scanner.Text()})
	}

	session.Wait()
}
