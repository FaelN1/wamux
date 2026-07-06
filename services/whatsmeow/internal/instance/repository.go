package instance

import (
	"context"
	"database/sql"
	"fmt"
)

type Repository interface {
	Create(ctx context.Context, inst *Instance) error
	GetByID(ctx context.Context, id string) (*Instance, error)
	GetByAPIKey(ctx context.Context, apiKey string) (*Instance, error)
	GetAll(ctx context.Context) ([]*Instance, error)
	Update(ctx context.Context, inst *Instance) error
	UpdateStatus(ctx context.Context, id, status string) error
	UpdatePhoneNumber(ctx context.Context, id, phone string) error
	Delete(ctx context.Context, id string) error
}

type postgresRepo struct {
	db *sql.DB
}

func NewRepository(db *sql.DB) Repository {
	return &postgresRepo{db: db}
}

const insertQuery = `
	INSERT INTO instances (id, company_name, side_name, api_key, webhook_url, webhook_events, proxy_url, status, phone_number)
	VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
	RETURNING created_at, updated_at`

const selectColumns = `id, company_name, side_name, api_key, webhook_url, webhook_events, proxy_url, status, phone_number, created_at, updated_at`

func scanInstance(row interface{ Scan(...interface{}) error }, inst *Instance) error {
	return row.Scan(
		&inst.ID, &inst.CompanyName, &inst.SideName, &inst.APIKey,
		&inst.WebhookURL, &inst.WebhookEvents, &inst.ProxyURL,
		&inst.Status, &inst.PhoneNumber,
		&inst.CreatedAt, &inst.UpdatedAt,
	)
}

func (r *postgresRepo) Create(ctx context.Context, inst *Instance) error {
	return r.db.QueryRowContext(ctx, insertQuery,
		inst.ID, inst.CompanyName, inst.SideName, inst.APIKey,
		inst.WebhookURL, inst.WebhookEvents, inst.ProxyURL,
		inst.Status, inst.PhoneNumber,
	).Scan(&inst.CreatedAt, &inst.UpdatedAt)
}

func (r *postgresRepo) GetByID(ctx context.Context, id string) (*Instance, error) {
	inst := &Instance{}
	err := scanInstance(
		r.db.QueryRowContext(ctx, "SELECT "+selectColumns+" FROM instances WHERE id = $1", id),
		inst,
	)
	if err == sql.ErrNoRows {
		return nil, fmt.Errorf("instance not found")
	}
	return inst, err
}

func (r *postgresRepo) GetByAPIKey(ctx context.Context, apiKey string) (*Instance, error) {
	inst := &Instance{}
	err := scanInstance(
		r.db.QueryRowContext(ctx, "SELECT "+selectColumns+" FROM instances WHERE api_key = $1", apiKey),
		inst,
	)
	if err == sql.ErrNoRows {
		return nil, fmt.Errorf("instance not found")
	}
	return inst, err
}

func (r *postgresRepo) GetAll(ctx context.Context) ([]*Instance, error) {
	rows, err := r.db.QueryContext(ctx, "SELECT "+selectColumns+" FROM instances ORDER BY created_at DESC")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var instances []*Instance
	for rows.Next() {
		inst := &Instance{}
		if err := scanInstance(rows, inst); err != nil {
			return nil, err
		}
		instances = append(instances, inst)
	}
	return instances, rows.Err()
}

func (r *postgresRepo) Update(ctx context.Context, inst *Instance) error {
	query := `
		UPDATE instances
		SET company_name = $2, side_name = $3, webhook_url = $4, webhook_events = $5, proxy_url = $6, updated_at = NOW()
		WHERE id = $1`

	result, err := r.db.ExecContext(ctx, query,
		inst.ID, inst.CompanyName, inst.SideName, inst.WebhookURL, inst.WebhookEvents, inst.ProxyURL,
	)
	if err != nil {
		return err
	}
	rows, _ := result.RowsAffected()
	if rows == 0 {
		return fmt.Errorf("instance not found")
	}
	return nil
}

func (r *postgresRepo) UpdateStatus(ctx context.Context, id, status string) error {
	result, err := r.db.ExecContext(ctx, `UPDATE instances SET status = $2, updated_at = NOW() WHERE id = $1`, id, status)
	if err != nil {
		return err
	}
	rows, _ := result.RowsAffected()
	if rows == 0 {
		return fmt.Errorf("instance not found")
	}
	return nil
}

func (r *postgresRepo) UpdatePhoneNumber(ctx context.Context, id, phone string) error {
	_, err := r.db.ExecContext(ctx, `UPDATE instances SET phone_number = $2, updated_at = NOW() WHERE id = $1`, id, phone)
	return err
}

func (r *postgresRepo) Delete(ctx context.Context, id string) error {
	// Transacional: as tabelas escopadas por instância precisam sair antes de
	// `instances` — webhook_deliveries tem FK sem ON DELETE CASCADE (o delete
	// direto quebra com 23503); as demais só deixariam linhas órfãs.
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()

	for _, table := range []string{"webhook_deliveries", "message_log", "message_queue", "contacts"} {
		if _, err := tx.ExecContext(ctx, `DELETE FROM `+table+` WHERE instance_id = $1`, id); err != nil {
			return fmt.Errorf("delete %s: %w", table, err)
		}
	}

	result, err := tx.ExecContext(ctx, `DELETE FROM instances WHERE id = $1`, id)
	if err != nil {
		return err
	}
	rows, _ := result.RowsAffected()
	if rows == 0 {
		return fmt.Errorf("instance not found")
	}
	return tx.Commit()
}
