package database

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"path/filepath"

	_ "github.com/lib/pq"
	_ "modernc.org/sqlite"
	"go.mau.fi/whatsmeow/store/sqlstore"
	waLog "go.mau.fi/whatsmeow/util/log"
)

func ConnectPostgres(databaseURL string) (*sql.DB, error) {
	db, err := sql.Open("postgres", databaseURL)
	if err != nil {
		return nil, fmt.Errorf("failed to open postgres: %w", err)
	}

	if err := db.Ping(); err != nil {
		return nil, fmt.Errorf("failed to ping postgres: %w", err)
	}

	db.SetMaxOpenConns(25)
	db.SetMaxIdleConns(5)

	return db, nil
}

func RunMigrations(db *sql.DB) error {
	migrations := []string{
		`CREATE TABLE IF NOT EXISTS instances (
			id           VARCHAR PRIMARY KEY,
			company_name VARCHAR NOT NULL,
			side_name    VARCHAR NOT NULL,
			api_key      VARCHAR NOT NULL UNIQUE,
			webhook_url  VARCHAR,
			status       VARCHAR NOT NULL DEFAULT 'disconnected',
			phone_number VARCHAR,
			created_at   TIMESTAMPTZ DEFAULT NOW(),
			updated_at   TIMESTAMPTZ DEFAULT NOW(),
			UNIQUE(company_name, side_name)
		)`,
		`ALTER TABLE instances ADD COLUMN IF NOT EXISTS webhook_events JSONB DEFAULT '[]'`,
		`ALTER TABLE instances ADD COLUMN IF NOT EXISTS proxy_url VARCHAR DEFAULT ''`,
		`CREATE INDEX IF NOT EXISTS idx_instances_api_key ON instances(api_key)`,
		`CREATE INDEX IF NOT EXISTS idx_instances_status ON instances(status)`,
		`CREATE TABLE IF NOT EXISTS webhook_deliveries (
			id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			instance_id      VARCHAR NOT NULL REFERENCES instances(id),
			event            VARCHAR NOT NULL,
			payload          JSONB NOT NULL,
			status           VARCHAR NOT NULL DEFAULT 'pending',
			attempts         INT DEFAULT 0,
			next_attempt_at  TIMESTAMPTZ,
			last_http_status INT,
			last_error       TEXT,
			created_at       TIMESTAMPTZ DEFAULT NOW(),
			delivered_at     TIMESTAMPTZ,
			discarded_at     TIMESTAMPTZ
		)`,
		`CREATE INDEX IF NOT EXISTS idx_deliveries_status ON webhook_deliveries(status)`,
		`CREATE INDEX IF NOT EXISTS idx_deliveries_next_attempt ON webhook_deliveries(next_attempt_at) WHERE status = 'pending'`,
		`CREATE INDEX IF NOT EXISTS idx_deliveries_instance ON webhook_deliveries(instance_id)`,
		// Message log
		`CREATE TABLE IF NOT EXISTS message_log (
			id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			instance_id  VARCHAR NOT NULL,
			direction    VARCHAR NOT NULL,
			message_id   VARCHAR,
			chat         VARCHAR NOT NULL,
			sender       VARCHAR,
			msg_type     VARCHAR NOT NULL DEFAULT 'text',
			text         TEXT,
			has_media    BOOLEAN DEFAULT FALSE,
			mime_type    VARCHAR,
			status       VARCHAR NOT NULL DEFAULT 'sent',
			error        TEXT,
			created_at   TIMESTAMPTZ DEFAULT NOW()
		)`,
		`CREATE INDEX IF NOT EXISTS idx_msglog_instance ON message_log(instance_id)`,
		`CREATE INDEX IF NOT EXISTS idx_msglog_created ON message_log(created_at)`,
		`CREATE INDEX IF NOT EXISTS idx_msglog_direction ON message_log(instance_id, direction)`,
		// Message queue
		`CREATE TABLE IF NOT EXISTS message_queue (
			id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			instance_id  VARCHAR NOT NULL,
			msg_type     VARCHAR NOT NULL,
			payload      JSONB NOT NULL,
			status       VARCHAR NOT NULL DEFAULT 'pending',
			attempts     INT DEFAULT 0,
			max_attempts INT DEFAULT 3,
			result_id    VARCHAR,
			error        TEXT,
			scheduled_at TIMESTAMPTZ DEFAULT NOW(),
			processed_at TIMESTAMPTZ,
			created_at   TIMESTAMPTZ DEFAULT NOW()
		)`,
		`CREATE INDEX IF NOT EXISTS idx_msgqueue_status ON message_queue(status, scheduled_at)`,
		`CREATE INDEX IF NOT EXISTS idx_msgqueue_instance ON message_queue(instance_id)`,
		// Contacts
		`CREATE TABLE IF NOT EXISTS contacts (
			id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			instance_id     VARCHAR NOT NULL,
			jid             VARCHAR NOT NULL,
			name            VARCHAR,
			phone           VARCHAR,
			picture_url     VARCHAR,
			status_text     VARCHAR,
			is_group        BOOLEAN DEFAULT FALSE,
			last_message_at TIMESTAMPTZ,
			last_message    TEXT,
			unread_count    INT DEFAULT 0,
			created_at      TIMESTAMPTZ DEFAULT NOW(),
			updated_at      TIMESTAMPTZ DEFAULT NOW(),
			UNIQUE(instance_id, jid)
		)`,
		`CREATE INDEX IF NOT EXISTS idx_contacts_instance ON contacts(instance_id, last_message_at DESC)`,
		`CREATE INDEX IF NOT EXISTS idx_contacts_jid ON contacts(instance_id, jid)`,
		// Fix URL-encoded JIDs in message_log and contacts
		`UPDATE message_log SET chat = REPLACE(chat, '%40', '@') WHERE chat LIKE '%\%40%'`,
		`UPDATE message_log SET sender = REPLACE(sender, '%40', '@') WHERE sender LIKE '%\%40%'`,
		`UPDATE contacts SET jid = REPLACE(jid, '%40', '@') WHERE jid LIKE '%\%40%'`,
	}

	for _, m := range migrations {
		if _, err := db.Exec(m); err != nil {
			return fmt.Errorf("migration failed: %w", err)
		}
	}

	return nil
}

func GetSQLiteStore(sessionDir, instanceID string) (*sqlstore.Container, error) {
	if err := os.MkdirAll(sessionDir, 0750); err != nil {
		return nil, fmt.Errorf("failed to create session dir: %w", err)
	}

	dbPath := filepath.Join(sessionDir, instanceID+".db")

	container, err := sqlstore.New(context.Background(), "sqlite3", dbPath, waLog.Noop)
	if err != nil {
		return nil, fmt.Errorf("failed to create sqlstore: %w", err)
	}

	return container, nil
}
