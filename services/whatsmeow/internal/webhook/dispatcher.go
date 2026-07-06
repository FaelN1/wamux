package webhook

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/getsentry/sentry-go"
	"github.com/rs/zerolog"
)

type Dispatcher struct {
	repo       DeliveryRepository
	httpClient *http.Client
	logger     zerolog.Logger
}

func NewDispatcher(repo DeliveryRepository, logger zerolog.Logger) *Dispatcher {
	return &Dispatcher{
		repo: repo,
		httpClient: &http.Client{
			Timeout: RequestTimeout,
		},
		logger: logger,
	}
}

func (d *Dispatcher) Dispatch(ctx context.Context, instanceID, webhookURL, event string, data interface{}) error {
	if webhookURL == "" {
		return nil
	}

	payload := WebhookPayload{
		Event:      event,
		InstanceID: instanceID,
		Timestamp:  time.Now(),
		Data:       data,
	}

	payloadBytes, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("failed to marshal webhook payload: %w", err)
	}

	now := time.Now()
	delivery := &Delivery{
		InstanceID:    instanceID,
		Event:         event,
		Payload:       payloadBytes,
		Status:        StatusPending,
		Attempts:      0,
		NextAttemptAt: &now,
	}

	if err := d.repo.Create(ctx, delivery); err != nil {
		return fmt.Errorf("failed to save webhook delivery: %w", err)
	}

	go d.attemptDelivery(delivery, webhookURL)

	return nil
}

func (d *Dispatcher) attemptDelivery(delivery *Delivery, webhookURL string) {
	ctx := context.Background()

	for delivery.Attempts < MaxAttempts {
		delivery.Attempts++

		delay := nextRetryDelay(delivery.Attempts - 1)
		if delay > 0 {
			time.Sleep(delay)
		}

		statusCode, err := d.sendHTTP(webhookURL, delivery.Payload)

		if err == nil && statusCode >= 200 && statusCode < 300 {
			now := time.Now()
			delivery.Status = StatusDelivered
			delivery.LastHTTPStatus = &statusCode
			delivery.DeliveredAt = &now
			delivery.NextAttemptAt = nil
			if updateErr := d.repo.UpdateStatus(ctx, delivery); updateErr != nil {
				d.logger.Error().Err(updateErr).Str("delivery_id", delivery.ID).Msg("failed to update delivery status")
			}
			d.logger.Debug().
				Str("delivery_id", delivery.ID).
				Str("event", delivery.Event).
				Int("attempts", delivery.Attempts).
				Msg("webhook delivered")
			return
		}

		if statusCode >= 400 && statusCode < 500 {
			now := time.Now()
			errMsg := fmt.Sprintf("HTTP %d - client error, not retrying", statusCode)
			delivery.Status = StatusDiscarded
			delivery.LastHTTPStatus = &statusCode
			delivery.LastError = &errMsg
			delivery.DiscardedAt = &now
			delivery.NextAttemptAt = nil
			if updateErr := d.repo.UpdateStatus(ctx, delivery); updateErr != nil {
				d.logger.Error().Err(updateErr).Str("delivery_id", delivery.ID).Msg("failed to update delivery status")
			}
			d.logger.Warn().
				Str("delivery_id", delivery.ID).
				Int("status_code", statusCode).
				Msg("webhook discarded due to client error")
			return
		}

		errMsg := ""
		if err != nil {
			errMsg = err.Error()
		} else {
			errMsg = fmt.Sprintf("HTTP %d", statusCode)
		}
		delivery.LastError = &errMsg
		if statusCode > 0 {
			delivery.LastHTTPStatus = &statusCode
		}

		if delivery.Attempts < MaxAttempts {
			nextDelay := nextRetryDelay(delivery.Attempts)
			nextAt := time.Now().Add(nextDelay)
			delivery.NextAttemptAt = &nextAt
		}

		if updateErr := d.repo.UpdateStatus(ctx, delivery); updateErr != nil {
			d.logger.Error().Err(updateErr).Str("delivery_id", delivery.ID).Msg("failed to update delivery status")
		}

		d.logger.Warn().
			Str("delivery_id", delivery.ID).
			Int("attempt", delivery.Attempts).
			Str("error", errMsg).
			Msg("webhook delivery failed, retrying")
	}

	now := time.Now()
	delivery.Status = StatusDiscarded
	delivery.DiscardedAt = &now
	delivery.NextAttemptAt = nil
	if updateErr := d.repo.UpdateStatus(ctx, delivery); updateErr != nil {
		d.logger.Error().Err(updateErr).Str("delivery_id", delivery.ID).Msg("failed to update delivery status")
	}

	d.logger.Error().
		Str("delivery_id", delivery.ID).
		Str("event", delivery.Event).
		Int("attempts", delivery.Attempts).
		Msg("webhook discarded after max retries")

	sentry.CaptureException(fmt.Errorf("webhook discarded after %d attempts: instance=%s event=%s",
		delivery.Attempts, delivery.InstanceID, delivery.Event))
}

func (d *Dispatcher) sendHTTP(url string, payload []byte) (int, error) {
	req, err := http.NewRequest(http.MethodPost, url, bytes.NewReader(payload))
	if err != nil {
		return 0, err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := d.httpClient.Do(req)
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()
	io.Copy(io.Discard, resp.Body)

	return resp.StatusCode, nil
}

func (d *Dispatcher) ProcessPending() {
	ctx := context.Background()

	deliveries, err := d.repo.GetPending(ctx)
	if err != nil {
		d.logger.Error().Err(err).Msg("failed to fetch pending deliveries")
		return
	}

	if len(deliveries) == 0 {
		return
	}

	d.logger.Info().Int("count", len(deliveries)).Msg("processing pending webhook deliveries")

	for _, delivery := range deliveries {
		// Discard deliveries that can't be resolved (no webhook URL lookup available)
		now := time.Now()
		errMsg := "no webhook URL configured"
		delivery.Status = StatusDiscarded
		delivery.LastError = &errMsg
		delivery.DiscardedAt = &now
		delivery.NextAttemptAt = nil
		_ = d.repo.UpdateStatus(ctx, delivery)
	}
}

func (d *Dispatcher) StartWorker(interval time.Duration, stop <-chan struct{}) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			d.ProcessPending()
		case <-stop:
			return
		}
	}
}
