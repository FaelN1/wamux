package msgqueue

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"time"

	"github.com/rs/zerolog"
)

type Message struct {
	ID          string          `json:"id"`
	InstanceID  string          `json:"instance_id"`
	MsgType     string          `json:"msg_type"` // text, media, poll
	Payload     json.RawMessage `json:"payload"`
	Status      string          `json:"status"` // pending, processing, sent, failed
	Attempts    int             `json:"attempts"`
	MaxAttempts int             `json:"max_attempts"`
	ResultID    string          `json:"result_id,omitempty"`
	Error       string          `json:"error,omitempty"`
	ScheduledAt time.Time       `json:"scheduled_at"`
	ProcessedAt *time.Time      `json:"processed_at,omitempty"`
	CreatedAt   time.Time       `json:"created_at"`
}

// SendFunc is called by the worker to actually send a message. Returns message_id or error.
type SendFunc func(instanceID, msgType string, payload json.RawMessage) (string, error)

type Queue struct {
	db       *sql.DB
	sendFunc SendFunc
	log      zerolog.Logger
	rate     time.Duration // min delay between sends per instance
}

func NewQueue(db *sql.DB, sendFunc SendFunc, log zerolog.Logger) *Queue {
	return &Queue{
		db:       db,
		sendFunc: sendFunc,
		log:      log,
		rate:     2 * time.Second, // 30 msgs/min per instance
	}
}

func (q *Queue) Enqueue(ctx context.Context, instanceID, msgType string, payload interface{}) (string, error) {
	data, err := json.Marshal(payload)
	if err != nil {
		return "", fmt.Errorf("failed to marshal payload: %w", err)
	}

	var id string
	err = q.db.QueryRowContext(ctx, `
		INSERT INTO message_queue (instance_id, msg_type, payload)
		VALUES ($1, $2, $3) RETURNING id`,
		instanceID, msgType, data,
	).Scan(&id)
	if err != nil {
		return "", fmt.Errorf("failed to enqueue: %w", err)
	}

	return id, nil
}

func (q *Queue) EnqueueBatch(ctx context.Context, instanceID, msgType string, payloads []interface{}, delayBetween time.Duration) ([]string, error) {
	var ids []string
	now := time.Now()
	for i, p := range payloads {
		data, err := json.Marshal(p)
		if err != nil {
			return ids, fmt.Errorf("failed to marshal payload %d: %w", i, err)
		}
		scheduledAt := now.Add(time.Duration(i) * delayBetween)
		var id string
		err = q.db.QueryRowContext(ctx, `
			INSERT INTO message_queue (instance_id, msg_type, payload, scheduled_at)
			VALUES ($1, $2, $3, $4) RETURNING id`,
			instanceID, msgType, data, scheduledAt,
		).Scan(&id)
		if err != nil {
			return ids, fmt.Errorf("failed to enqueue %d: %w", i, err)
		}
		ids = append(ids, id)
	}
	return ids, nil
}

func (q *Queue) StartWorker(stop <-chan struct{}) {
	ticker := time.NewTicker(1 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			q.processBatch()
		case <-stop:
			return
		}
	}
}

func (q *Queue) processBatch() {
	ctx := context.Background()

	rows, err := q.db.QueryContext(ctx, `
		UPDATE message_queue SET status = 'processing', attempts = attempts + 1
		WHERE id IN (
			SELECT id FROM message_queue
			WHERE status = 'pending' AND scheduled_at <= NOW()
			ORDER BY scheduled_at ASC
			LIMIT 10
			FOR UPDATE SKIP LOCKED
		) RETURNING id, instance_id, msg_type, payload, attempts, max_attempts`)
	if err != nil {
		return
	}
	defer rows.Close()

	var messages []Message
	for rows.Next() {
		var m Message
		if err := rows.Scan(&m.ID, &m.InstanceID, &m.MsgType, &m.Payload, &m.Attempts, &m.MaxAttempts); err != nil {
			continue
		}
		messages = append(messages, m)
	}

	for _, m := range messages {
		resultID, err := q.sendFunc(m.InstanceID, m.MsgType, m.Payload)
		now := time.Now()
		if err != nil {
			if m.Attempts >= m.MaxAttempts {
				_, _ = q.db.ExecContext(ctx, `UPDATE message_queue SET status = 'failed', error = $2, processed_at = $3 WHERE id = $1`,
					m.ID, err.Error(), now)
				q.log.Warn().Str("queue_id", m.ID).Err(err).Msg("message failed permanently")
			} else {
				// Retry with backoff
				nextAt := now.Add(time.Duration(m.Attempts*m.Attempts) * 5 * time.Second)
				_, _ = q.db.ExecContext(ctx, `UPDATE message_queue SET status = 'pending', error = $2, scheduled_at = $3 WHERE id = $1`,
					m.ID, err.Error(), nextAt)
			}
		} else {
			_, _ = q.db.ExecContext(ctx, `UPDATE message_queue SET status = 'sent', result_id = $2, processed_at = $3 WHERE id = $1`,
				m.ID, resultID, now)
		}
	}
}

func (q *Queue) GetStatus(ctx context.Context, queueID string) (*Message, error) {
	m := &Message{}
	err := q.db.QueryRowContext(ctx, `
		SELECT id, instance_id, msg_type, payload, status, attempts, max_attempts,
		       COALESCE(result_id,''), COALESCE(error,''), scheduled_at, processed_at, created_at
		FROM message_queue WHERE id = $1`, queueID,
	).Scan(&m.ID, &m.InstanceID, &m.MsgType, &m.Payload, &m.Status, &m.Attempts, &m.MaxAttempts,
		&m.ResultID, &m.Error, &m.ScheduledAt, &m.ProcessedAt, &m.CreatedAt)
	if err == sql.ErrNoRows {
		return nil, fmt.Errorf("queue item not found")
	}
	return m, err
}
