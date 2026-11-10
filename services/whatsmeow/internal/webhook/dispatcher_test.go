package webhook

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/rs/zerolog"
)

func TestSendHTTPSignsExactPayload(t *testing.T) {
	const key = "master-key-for-test"
	payload := []byte(`{"event":"MESSAGE","instance_id":"abc","data":{"text":"olá"}}`)

	var gotHeader string
	var gotBody []byte
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotHeader = r.Header.Get(SignatureHeader)
		gotBody, _ = io.ReadAll(r.Body)
		w.WriteHeader(http.StatusNoContent)
	}))
	defer srv.Close()

	d := NewDispatcher(nil, zerolog.Nop(), key)
	status, err := d.sendHTTP(srv.URL, payload)
	if err != nil {
		t.Fatalf("sendHTTP failed: %v", err)
	}
	if status != http.StatusNoContent {
		t.Fatalf("unexpected status %d", status)
	}
	if string(gotBody) != string(payload) {
		t.Fatalf("body was altered in transit: %q", gotBody)
	}

	hexSig, ok := strings.CutPrefix(gotHeader, "sha256=")
	if !ok {
		t.Fatalf("signature header %q lacks the sha256= prefix", gotHeader)
	}
	if hexSig != strings.ToLower(hexSig) {
		t.Fatalf("signature %q is not lowercase hex", hexSig)
	}
	sig, err := hex.DecodeString(hexSig)
	if err != nil {
		t.Fatalf("signature is not valid hex: %v", err)
	}

	// Verify independently, over the bytes the server actually received.
	mac := hmac.New(sha256.New, []byte(key))
	mac.Write(gotBody)
	if !hmac.Equal(sig, mac.Sum(nil)) {
		t.Fatalf("signature %q does not verify against the received body", gotHeader)
	}

	// A different key must not verify.
	other := hmac.New(sha256.New, []byte("another-key"))
	other.Write(gotBody)
	if hmac.Equal(sig, other.Sum(nil)) {
		t.Fatal("signature verified with the wrong key")
	}
}

func TestSendHTTPWithoutKeyOmitsSignature(t *testing.T) {
	var present bool
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, present = r.Header[SignatureHeader]
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	d := NewDispatcher(nil, zerolog.Nop(), "")
	if _, err := d.sendHTTP(srv.URL, []byte(`{}`)); err != nil {
		t.Fatalf("sendHTTP failed: %v", err)
	}
	if present {
		t.Fatal("signature header sent without a signing key")
	}
}
