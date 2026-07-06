package webhook

import (
	"context"
	"database/sql"
	"encoding/json"
	"time"
)

type DeliveryRepository interface {
	Create(ctx context.Context, d *Delivery) error
	GetPending(ctx context.Context) ([]*Delivery, error)
	UpdateStatus(ctx context.Context, d *Delivery) error
}

type postgresDeliveryRepo struct {
	db *sql.DB
}

func NewDeliveryRepository(db *sql.DB) DeliveryRepository {
	return &postgresDeliveryRepo{db: db}
}

func (r *postgresDeliveryRepo) Create(ctx context.Context, d *Delivery) error {
	query := `
		INSERT INTO webhook_deliveries (instance_id, event, payload, status, attempts, next_attempt_at)
		VALUES ($1, $2, $3, $4, $5, $6)
		RETURNING id, created_at`

	return r.db.QueryRowContext(ctx, query,
		d.InstanceID, d.Event, d.Payload, d.Status, d.Attempts, d.NextAttemptAt,
	).Scan(&d.ID, &d.CreatedAt)
}

func (r *postgresDeliveryRepo) GetPending(ctx context.Context) ([]*Delivery, error) {
	query := `
		SELECT id, instance_id, event, payload, status, attempts, next_attempt_at,
		       last_http_status, last_error, created_at, delivered_at, discarded_at
		FROM webhook_deliveries
		WHERE status = 'pending' AND (next_attempt_at IS NULL OR next_attempt_at <= $1)
		ORDER BY created_at ASC
		LIMIT 100`

	rows, err := r.db.QueryContext(ctx, query, time.Now())
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var deliveries []*Delivery
	for rows.Next() {
		d := &Delivery{}
		var payload []byte
		if err := rows.Scan(
			&d.ID, &d.InstanceID, &d.Event, &payload, &d.Status, &d.Attempts,
			&d.NextAttemptAt, &d.LastHTTPStatus, &d.LastError,
			&d.CreatedAt, &d.DeliveredAt, &d.DiscardedAt,
		); err != nil {
			return nil, err
		}
		d.Payload = json.RawMessage(payload)
		deliveries = append(deliveries, d)
	}
	return deliveries, rows.Err()
}

func (r *postgresDeliveryRepo) UpdateStatus(ctx context.Context, d *Delivery) error {
	query := `
		UPDATE webhook_deliveries
		SET status = $2, attempts = $3, next_attempt_at = $4,
		    last_http_status = $5, last_error = $6,
		    delivered_at = $7, discarded_at = $8
		WHERE id = $1`

	_, err := r.db.ExecContext(ctx, query,
		d.ID, d.Status, d.Attempts, d.NextAttemptAt,
		d.LastHTTPStatus, d.LastError,
		d.DeliveredAt, d.DiscardedAt,
	)
	return err
}
