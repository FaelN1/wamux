package msglog

import (
	"context"
	"database/sql"
	"time"
)

const (
	DirectionIncoming = "incoming"
	DirectionOutgoing = "outgoing"
)

type Entry struct {
	ID         string    `json:"id"`
	InstanceID string    `json:"instance_id"`
	Direction  string    `json:"direction"`
	MessageID  string    `json:"message_id,omitempty"`
	Chat       string    `json:"chat"`
	Sender     string    `json:"sender,omitempty"`
	MsgType    string    `json:"msg_type"`
	Text       string    `json:"text,omitempty"`
	HasMedia   bool      `json:"has_media"`
	MimeType   string    `json:"mime_type,omitempty"`
	Status     string    `json:"status"`
	Error      string    `json:"error,omitempty"`
	CreatedAt  time.Time `json:"created_at"`
}

type Store struct {
	db *sql.DB
}

func NewStore(db *sql.DB) *Store {
	return &Store{db: db}
}

func (s *Store) LogOutgoing(ctx context.Context, instanceID, messageID, chat, msgType, text string, hasMedia bool, mimeType, status, errMsg string) {
	_, _ = s.db.ExecContext(ctx, `
		INSERT INTO message_log (instance_id, direction, message_id, chat, msg_type, text, has_media, mime_type, status, error)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
		instanceID, DirectionOutgoing, messageID, chat, msgType, text, hasMedia, mimeType, status, errMsg,
	)
}

func (s *Store) LogIncoming(ctx context.Context, instanceID, messageID, chat, sender, msgType, text string, hasMedia bool, mimeType string) {
	_, _ = s.db.ExecContext(ctx, `
		INSERT INTO message_log (instance_id, direction, message_id, chat, sender, msg_type, text, has_media, mime_type, status)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'received')`,
		instanceID, DirectionIncoming, messageID, chat, sender, msgType, text, hasMedia, mimeType,
	)
}

func (s *Store) GetHistory(ctx context.Context, instanceID string, limit, offset int) ([]Entry, int, error) {
	var total int
	err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM message_log WHERE instance_id = $1`, instanceID).Scan(&total)
	if err != nil {
		return nil, 0, err
	}

	rows, err := s.db.QueryContext(ctx, `
		SELECT id, instance_id, direction, COALESCE(message_id,''), chat, COALESCE(sender,''),
		       msg_type, COALESCE(text,''), has_media, COALESCE(mime_type,''), status, COALESCE(error,''), created_at
		FROM message_log WHERE instance_id = $1
		ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
		instanceID, limit, offset,
	)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	var entries []Entry
	for rows.Next() {
		var e Entry
		if err := rows.Scan(&e.ID, &e.InstanceID, &e.Direction, &e.MessageID, &e.Chat, &e.Sender,
			&e.MsgType, &e.Text, &e.HasMedia, &e.MimeType, &e.Status, &e.Error, &e.CreatedAt); err != nil {
			return nil, 0, err
		}
		entries = append(entries, e)
	}
	return entries, total, nil
}

func (s *Store) GetChatHistory(ctx context.Context, instanceID, chatJID string, limit, offset int) ([]Entry, int, error) {
	var total int
	err := s.db.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM message_log WHERE instance_id = $1 AND chat = $2`,
		instanceID, chatJID,
	).Scan(&total)
	if err != nil {
		return nil, 0, err
	}

	rows, err := s.db.QueryContext(ctx, `
		SELECT id, instance_id, direction, COALESCE(message_id,''), chat, COALESCE(sender,''),
		       msg_type, COALESCE(text,''), has_media, COALESCE(mime_type,''), status, COALESCE(error,''), created_at
		FROM message_log WHERE instance_id = $1 AND chat = $2
		ORDER BY created_at ASC LIMIT $3 OFFSET $4`,
		instanceID, chatJID, limit, offset,
	)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	var entries []Entry
	for rows.Next() {
		var e Entry
		if err := rows.Scan(&e.ID, &e.InstanceID, &e.Direction, &e.MessageID, &e.Chat, &e.Sender,
			&e.MsgType, &e.Text, &e.HasMedia, &e.MimeType, &e.Status, &e.Error, &e.CreatedAt); err != nil {
			return nil, 0, err
		}
		entries = append(entries, e)
	}
	return entries, total, nil
}

type Stats struct {
	TotalSent     int `json:"total_sent"`
	TotalReceived int `json:"total_received"`
	SentToday     int `json:"sent_today"`
	ReceivedToday int `json:"received_today"`
	ErrorsToday   int `json:"errors_today"`
}

func (s *Store) GetStats(ctx context.Context, instanceID string) (*Stats, error) {
	stats := &Stats{}
	today := time.Now().Truncate(24 * time.Hour)

	_ = s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM message_log WHERE instance_id = $1 AND direction = 'outgoing'`, instanceID).Scan(&stats.TotalSent)
	_ = s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM message_log WHERE instance_id = $1 AND direction = 'incoming'`, instanceID).Scan(&stats.TotalReceived)
	_ = s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM message_log WHERE instance_id = $1 AND direction = 'outgoing' AND created_at >= $2`, instanceID, today).Scan(&stats.SentToday)
	_ = s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM message_log WHERE instance_id = $1 AND direction = 'incoming' AND created_at >= $2`, instanceID, today).Scan(&stats.ReceivedToday)
	_ = s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM message_log WHERE instance_id = $1 AND status = 'error' AND created_at >= $2`, instanceID, today).Scan(&stats.ErrorsToday)

	return stats, nil
}

func (s *Store) GetGlobalStats(ctx context.Context) (*Stats, error) {
	stats := &Stats{}
	today := time.Now().Truncate(24 * time.Hour)

	_ = s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM message_log WHERE direction = 'outgoing'`).Scan(&stats.TotalSent)
	_ = s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM message_log WHERE direction = 'incoming'`).Scan(&stats.TotalReceived)
	_ = s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM message_log WHERE direction = 'outgoing' AND created_at >= $1`, today).Scan(&stats.SentToday)
	_ = s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM message_log WHERE direction = 'incoming' AND created_at >= $1`, today).Scan(&stats.ReceivedToday)
	_ = s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM message_log WHERE status = 'error' AND created_at >= $1`, today).Scan(&stats.ErrorsToday)

	return stats, nil
}
