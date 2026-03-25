package main

import (
	"encoding/json"
	"io/ioutil"
	"log"
)

type User struct {
	Username     string `json:"username"`
	Password     string `json:"password,omitempty"`
	PasswordHash string `json:"passwordHash,omitempty"`
}

type LogFile struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Path string `json:"path"`
}

type Server struct {
	ID             string    `json:"id"`
	Name           string    `json:"name"`
	Host           string    `json:"host"`
	Port           int       `json:"port"`
	Username       string    `json:"username"`
	AuthType       string    `json:"authType"`
	Password       string    `json:"password,omitempty"`
	PrivateKeyPath string    `json:"privateKeyPath,omitempty"`
	LogFiles       []LogFile `json:"logFiles"`
}

type Config struct {
	Users     []User   `json:"users"`
	Servers   []Server `json:"servers"`
	JWTSecret string   `json:"jwtSecret"`
}

var AppConfig Config

func LoadConfig() {
	data, err := ioutil.ReadFile("config.json")
	if err != nil {
		log.Fatalf("Could not read config.json: %v", err)
	}
	err = json.Unmarshal(data, &AppConfig)
	if err != nil {
		log.Fatalf("Could not parse config.json: %v", err)
	}
}
