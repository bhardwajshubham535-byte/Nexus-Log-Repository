package main

import (
	"encoding/json"
	"log"
	"net/http"
)

type SafeServer struct {
	ID       string    `json:"id"`
	Name     string    `json:"name"`
	LogFiles []LogFile `json:"logFiles"`
}

func handleGetServers(w http.ResponseWriter, r *http.Request) {
	var safe []SafeServer
	for _, s := range AppConfig.Servers {
		safe = append(safe, SafeServer{
			ID:       s.ID,
			Name:     s.Name,
			LogFiles: s.LogFiles,
		})
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(safe)
}

func main() {
	LoadConfig()

	http.Handle("/", http.FileServer(http.Dir("./public")))
	http.HandleFunc("/api/login", handleLogin)
	http.HandleFunc("/api/servers", authMiddleware(handleGetServers))
	http.HandleFunc("/ws", handleWebSocket)

	log.Println("Golang Log Viewer Server listening on :3000")
	if err := http.ListenAndServe(":3000", nil); err != nil {
		log.Fatalf("Server failed: %v", err)
	}
}
