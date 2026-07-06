package instance

import (
	"database/sql/driver"
	"encoding/json"
	"time"
)

const (
	StatusDisconnected = "disconnected"
	StatusConnecting   = "connecting"
	StatusConnected    = "connected"
	StatusLoggedOut    = "logged_out"
)

// WebhookEvents is a string slice that serializes to/from JSON in PostgreSQL
type WebhookEvents []string

func (w WebhookEvents) Value() (driver.Value, error) {
	if w == nil {
		return "[]", nil
	}
	b, err := json.Marshal(w)
	return string(b), err
}

func (w *WebhookEvents) Scan(src interface{}) error {
	if src == nil {
		*w = WebhookEvents{}
		return nil
	}
	var s string
	switch v := src.(type) {
	case string:
		s = v
	case []byte:
		s = string(v)
	default:
		*w = WebhookEvents{}
		return nil
	}
	return json.Unmarshal([]byte(s), w)
}

type Instance struct {
	ID            string        `json:"id"`
	CompanyName   string        `json:"company_name"`
	SideName      string        `json:"side_name"`
	APIKey        string        `json:"api_key,omitempty"`
	WebhookURL    string        `json:"webhook_url"`
	WebhookEvents WebhookEvents `json:"webhook_events"`
	ProxyURL      string        `json:"proxy_url,omitempty"`
	Status        string        `json:"status"`
	PhoneNumber   string        `json:"phone_number"`
	CreatedAt     time.Time     `json:"created_at"`
	UpdatedAt     time.Time     `json:"updated_at"`
}

// HasWebhookEvent checks if a specific event is enabled for this instance
func (i *Instance) HasWebhookEvent(event string) bool {
	for _, e := range i.WebhookEvents {
		if e == event {
			return true
		}
	}
	return false
}

type CreateRequest struct {
	CompanyName   string   `json:"company_name"`
	SideName      string   `json:"side_name"`
	WebhookURL    string   `json:"webhook_url"`
	WebhookEvents []string `json:"webhook_events"`
	ProxyURL      string   `json:"proxy_url"`
	PhoneNumber   string   `json:"phone_number"`
}

type UpdateRequest struct {
	CompanyName   string   `json:"company_name"`
	SideName      string   `json:"side_name"`
	WebhookURL    string   `json:"webhook_url"`
	WebhookEvents []string `json:"webhook_events"`
	ProxyURL      string   `json:"proxy_url"`
}
