package chat

import (
	"context"
	"database/sql"
	"log"
	"time"
)

type Contact struct {
	ID            string     `json:"id"`
	InstanceID    string     `json:"instance_id"`
	JID           string     `json:"jid"`
	Name          string     `json:"name"`
	Phone         string     `json:"phone"`
	PictureURL    string     `json:"picture_url,omitempty"`
	StatusText    string     `json:"status_text,omitempty"`
	IsGroup       bool       `json:"is_group"`
	LastMessageAt *time.Time `json:"last_message_at,omitempty"`
	LastMessage   string     `json:"last_message,omitempty"`
	UnreadCount   int        `json:"unread_count"`
	CreatedAt     time.Time  `json:"created_at"`
	UpdatedAt     time.Time  `json:"updated_at"`
}

type Store struct {
	db *sql.DB
}

func NewStore(db *sql.DB) *Store {
	return &Store{db: db}
}

// Upsert creates or updates a contact, updating last message info
func (s *Store) Upsert(ctx context.Context, instanceID, jid, name, phone string, isGroup bool, lastMsg string, incrementUnread bool) {
	unread := 0
	if incrementUnread {
		unread = 1
	}

	_, err := s.db.ExecContext(ctx, `
		INSERT INTO contacts (instance_id, jid, name, phone, is_group, last_message, last_message_at, unread_count)
		VALUES ($1, $2, $3, $4, $5, $6, NOW(), $7)
		ON CONFLICT (instance_id, jid) DO UPDATE SET
			name = CASE WHEN $3 != '' THEN $3 ELSE contacts.name END,
			phone = CASE WHEN $4 != '' THEN $4 ELSE contacts.phone END,
			last_message = $6,
			last_message_at = NOW(),
			unread_count = contacts.unread_count + $7,
			updated_at = NOW()`,
		instanceID, jid, name, phone, isGroup, lastMsg, unread,
	)
	if err != nil {
		log.Printf("chat.Upsert error: %v (instance=%s jid=%s)", err, instanceID, jid)
	}
}

// UpdateProfile updates contact profile info (picture, status)
func (s *Store) UpdateProfile(ctx context.Context, instanceID, jid, name, pictureURL, statusText string) {
	_, _ = s.db.ExecContext(ctx, `
		UPDATE contacts SET
			name = CASE WHEN $3 != '' THEN $3 ELSE name END,
			picture_url = CASE WHEN $4 != '' THEN $4 ELSE picture_url END,
			status_text = CASE WHEN $5 != '' THEN $5 ELSE status_text END,
			updated_at = NOW()
		WHERE instance_id = $1 AND jid = $2`,
		instanceID, jid, name, pictureURL, statusText,
	)
}

// MarkRead resets unread count for a chat
func (s *Store) MarkRead(ctx context.Context, instanceID, jid string) {
	_, _ = s.db.ExecContext(ctx, `UPDATE contacts SET unread_count = 0 WHERE instance_id = $1 AND jid = $2`, instanceID, jid)
}

// ListChats returns contacts ordered by last message, with pagination
func (s *Store) ListChats(ctx context.Context, instanceID string, limit, offset int) ([]Contact, int, error) {
	var total int
	_ = s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM contacts WHERE instance_id = $1 AND last_message_at IS NOT NULL`, instanceID).Scan(&total)

	rows, err := s.db.QueryContext(ctx, `
		SELECT id, instance_id, jid, COALESCE(name,''), COALESCE(phone,''), COALESCE(picture_url,''),
		       COALESCE(status_text,''), is_group, last_message_at, COALESCE(last_message,''),
		       unread_count, created_at, updated_at
		FROM contacts
		WHERE instance_id = $1 AND last_message_at IS NOT NULL
		ORDER BY last_message_at DESC
		LIMIT $2 OFFSET $3`,
		instanceID, limit, offset,
	)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	var contacts []Contact
	for rows.Next() {
		var c Contact
		if err := rows.Scan(&c.ID, &c.InstanceID, &c.JID, &c.Name, &c.Phone, &c.PictureURL,
			&c.StatusText, &c.IsGroup, &c.LastMessageAt, &c.LastMessage,
			&c.UnreadCount, &c.CreatedAt, &c.UpdatedAt); err != nil {
			return nil, 0, err
		}
		contacts = append(contacts, c)
	}
	return contacts, total, nil
}

// GetContact returns a single contact
func (s *Store) GetContact(ctx context.Context, instanceID, jid string) (*Contact, error) {
	c := &Contact{}
	err := s.db.QueryRowContext(ctx, `
		SELECT id, instance_id, jid, COALESCE(name,''), COALESCE(phone,''), COALESCE(picture_url,''),
		       COALESCE(status_text,''), is_group, last_message_at, COALESCE(last_message,''),
		       unread_count, created_at, updated_at
		FROM contacts WHERE instance_id = $1 AND jid = $2`,
		instanceID, jid,
	).Scan(&c.ID, &c.InstanceID, &c.JID, &c.Name, &c.Phone, &c.PictureURL,
		&c.StatusText, &c.IsGroup, &c.LastMessageAt, &c.LastMessage,
		&c.UnreadCount, &c.CreatedAt, &c.UpdatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	return c, err
}

// Search contacts by name or phone
func (s *Store) Search(ctx context.Context, instanceID, query string, limit int) ([]Contact, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, instance_id, jid, COALESCE(name,''), COALESCE(phone,''), COALESCE(picture_url,''),
		       COALESCE(status_text,''), is_group, last_message_at, COALESCE(last_message,''),
		       unread_count, created_at, updated_at
		FROM contacts
		WHERE instance_id = $1 AND (name ILIKE $2 OR phone ILIKE $2 OR jid ILIKE $2)
		ORDER BY last_message_at DESC NULLS LAST
		LIMIT $3`,
		instanceID, "%"+query+"%", limit,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var contacts []Contact
	for rows.Next() {
		var c Contact
		if err := rows.Scan(&c.ID, &c.InstanceID, &c.JID, &c.Name, &c.Phone, &c.PictureURL,
			&c.StatusText, &c.IsGroup, &c.LastMessageAt, &c.LastMessage,
			&c.UnreadCount, &c.CreatedAt, &c.UpdatedAt); err != nil {
			return nil, err
		}
		contacts = append(contacts, c)
	}
	return contacts, nil
}
