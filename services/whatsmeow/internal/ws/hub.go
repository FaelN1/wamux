package ws

import (
	"encoding/json"
	"sync"

	"github.com/gofiber/contrib/websocket"
	"github.com/rs/zerolog"
)

type Event struct {
	Type string      `json:"type"`
	Data interface{} `json:"data"`
}

type Hub struct {
	mu      sync.RWMutex
	clients map[*websocket.Conn]bool
	log     zerolog.Logger
}

func NewHub(log zerolog.Logger) *Hub {
	return &Hub{
		clients: make(map[*websocket.Conn]bool),
		log:     log,
	}
}

func (h *Hub) Register(conn *websocket.Conn) {
	h.mu.Lock()
	h.clients[conn] = true
	h.mu.Unlock()
	h.log.Debug().Int("clients", len(h.clients)).Msg("ws client connected")
}

func (h *Hub) Unregister(conn *websocket.Conn) {
	h.mu.Lock()
	delete(h.clients, conn)
	h.mu.Unlock()
	h.log.Debug().Int("clients", len(h.clients)).Msg("ws client disconnected")
}

func (h *Hub) Broadcast(evt Event) {
	data, err := json.Marshal(evt)
	if err != nil {
		h.log.Error().Err(err).Msg("failed to marshal ws event")
		return
	}

	h.mu.RLock()
	defer h.mu.RUnlock()

	for conn := range h.clients {
		if err := conn.WriteMessage(websocket.TextMessage, data); err != nil {
			h.log.Warn().Err(err).Msg("failed to send ws message")
		}
	}
}

func (h *Hub) HandleConnection(conn *websocket.Conn) {
	h.Register(conn)
	defer h.Unregister(conn)

	// Keep connection alive by reading (discarding) incoming messages
	for {
		if _, _, err := conn.ReadMessage(); err != nil {
			break
		}
	}
}
