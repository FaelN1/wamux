package handler

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http/httptest"
	"testing"

	"github.com/gofiber/fiber/v2"
	"go.mau.fi/whatsmeow"
)

func TestSendErrorResponse(t *testing.T) {
	// Same wrapping the client layer applies on top of the upstream error.
	notOnWA := fmt.Errorf("failed to send text: %w",
		fmt.Errorf("%w: no LID found for 5511999999999@s.whatsapp.net from server", whatsmeow.ErrRecipientNotOnWhatsApp))

	cases := []struct {
		name   string
		err    error
		status int
		code   string
	}{
		{"recipient not on whatsapp", notOnWA, 422, "recipient_not_on_whatsapp"},
		{"generic failure", errors.New("failed to send text: boom"), 500, "internal_error"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			app := fiber.New()
			app.Get("/", func(c *fiber.Ctx) error { return sendErrorResponse(c, tc.err) })

			resp, err := app.Test(httptest.NewRequest("GET", "/", nil))
			if err != nil {
				t.Fatal(err)
			}
			if resp.StatusCode != tc.status {
				t.Fatalf("status = %d, want %d", resp.StatusCode, tc.status)
			}
			raw, _ := io.ReadAll(resp.Body)
			var body struct {
				Error   string `json:"error"`
				Message string `json:"message"`
				Status  int    `json:"status"`
			}
			if err := json.Unmarshal(raw, &body); err != nil {
				t.Fatalf("invalid body %s: %v", raw, err)
			}
			if body.Error != tc.code || body.Status != tc.status || body.Message != tc.err.Error() {
				t.Fatalf("unexpected body %s", raw)
			}
		})
	}
}
