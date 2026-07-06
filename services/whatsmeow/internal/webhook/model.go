package webhook

import (
	"encoding/json"
	"time"
)

const (
	StatusPending   = "pending"
	StatusDelivered = "delivered"
	StatusFailed    = "failed"
	StatusDiscarded = "discarded"

	MaxAttempts    = 7
	RequestTimeout = 10 * time.Second
)

var retryDelays = []time.Duration{
	0,
	1 * time.Second,
	2 * time.Second,
	4 * time.Second,
	8 * time.Second,
	16 * time.Second,
	32 * time.Second,
}

type Delivery struct {
	ID             string          `json:"id"`
	InstanceID     string          `json:"instance_id"`
	Event          string          `json:"event"`
	Payload        json.RawMessage `json:"payload"`
	Status         string          `json:"status"`
	Attempts       int             `json:"attempts"`
	NextAttemptAt  *time.Time      `json:"next_attempt_at,omitempty"`
	LastHTTPStatus *int            `json:"last_http_status,omitempty"`
	LastError      *string         `json:"last_error,omitempty"`
	CreatedAt      time.Time       `json:"created_at"`
	DeliveredAt    *time.Time      `json:"delivered_at,omitempty"`
	DiscardedAt    *time.Time      `json:"discarded_at,omitempty"`
}

type WebhookPayload struct {
	Event      string      `json:"event"`
	InstanceID string      `json:"instance_id"`
	Timestamp  time.Time   `json:"timestamp"`
	Data       interface{} `json:"data"`
}

func nextRetryDelay(attempt int) time.Duration {
	if attempt >= len(retryDelays) {
		return retryDelays[len(retryDelays)-1]
	}
	return retryDelays[attempt]
}
