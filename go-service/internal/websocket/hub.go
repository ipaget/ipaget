package websocket

import (
	"encoding/json"
	"sync"

	"ipaget-service/internal/logger"
	"ipaget-service/internal/models"

	"github.com/gorilla/websocket"
)

type Hub struct {
	clients    map[*Client]bool
	broadcast  chan interface{}
	register   chan *Client
	unregister chan *Client
	mu         sync.RWMutex
}

func NewHub() *Hub {
	return &Hub{
		broadcast:  make(chan interface{}, 256),
		register:   make(chan *Client),
		unregister: make(chan *Client),
		clients:    make(map[*Client]bool),
	}
}

func (h *Hub) Run() {
	for {
		select {
		case client := <-h.register:
			h.mu.Lock()
			h.clients[client] = true
			h.mu.Unlock()
			logger.Debug().Int("total", len(h.clients)).Msg("WebSocket client registered")

		case client := <-h.unregister:
			h.mu.Lock()
			if _, ok := h.clients[client]; ok {
				delete(h.clients, client)
				close(client.send)
			}
			h.mu.Unlock()
			logger.Debug().Int("total", len(h.clients)).Msg("WebSocket client unregistered")

		case event := <-h.broadcast:
			h.mu.RLock()
			clientCount := len(h.clients)
			h.mu.RUnlock()

			eventType := "unknown"
			logEvent := logger.Debug()

			if devEvent, ok := event.(models.DeviceEvent); ok {
				eventType = devEvent.Type
				logEvent = logEvent.
					Str("serial_number", devEvent.SerialNumber).
					Int("device_id", devEvent.DeviceID)
			} else if sizeUpdate, ok := event.(models.AppSizeUpdate); ok {
				eventType = sizeUpdate.Type
				logEvent = logEvent.
					Str("udid", sizeUpdate.UDID).
					Str("bundle_id", sizeUpdate.BundleID)
			} else if taskProgress, ok := event.(models.TaskProgress); ok {
				eventType = taskProgress.Type
				logEvent = logEvent.
					Str("task_id", taskProgress.TaskID).
					Str("task_type", taskProgress.TaskType).
					Str("status", taskProgress.Status).
					Float64("progress", taskProgress.Progress).
					Str("message", taskProgress.Message)
				if taskProgress.UDID != "" {
					logEvent = logEvent.Str("udid", taskProgress.UDID)
				}
				if taskProgress.BundleID != "" {
					logEvent = logEvent.Str("bundle_id", taskProgress.BundleID)
				}
				if taskProgress.FilePath != "" {
					logEvent = logEvent.Str("file_path", taskProgress.FilePath)
				}
			}

			logEvent.
				Str("event_type", eventType).
				Int("clients", clientCount).
				Msg("Broadcasting event to WebSocket clients")

			h.mu.RLock()
			sentCount := 0
			for client := range h.clients {
				select {
				case client.send <- event:
					sentCount++
				default:
					close(client.send)
					delete(h.clients, client)
					logger.Warn().Msg("Client channel full, disconnecting")
				}
			}
			h.mu.RUnlock()

			logger.Debug().Int("sent", sentCount).Msg("Event broadcast completed")
		}
	}
}

func (h *Hub) Broadcast(event interface{}) {
	select {
	case h.broadcast <- event:
	default:
		logger.Warn().Msg("Broadcast channel full, dropping event")
	}
}

func (h *Hub) Register(client *Client) {
	h.register <- client
}

type Client struct {
	hub  *Hub
	conn *websocket.Conn
	send chan interface{}
}

func NewClient(hub *Hub, conn *websocket.Conn) *Client {
	return &Client{
		hub:  hub,
		conn: conn,
		send: make(chan interface{}, 256),
	}
}

func (c *Client) ReadPump() {
	defer func() {
		c.hub.unregister <- c
		c.conn.Close()
	}()

	for {
		_, _, err := c.conn.ReadMessage()
		if err != nil {
			break
		}
	}
}

func (c *Client) WritePump() {
	defer c.conn.Close()

	for event := range c.send {
		data, err := json.Marshal(event)
		if err != nil {
			logger.Error().Err(err).Msg("Failed to marshal WebSocket event")
			continue
		}

		err = c.conn.WriteMessage(websocket.TextMessage, data)
		if err != nil {
			break
		}
	}
}
