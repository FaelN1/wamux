package whatsapp

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/rs/zerolog"
	"go.mau.fi/whatsmeow/proto/waE2E"
	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/types/events"
	"google.golang.org/protobuf/proto"
)

func messageEvent(msg *waE2E.Message) *events.Message {
	sender := types.NewJID("5511999999999", types.DefaultUserServer)
	return &events.Message{
		Info: types.MessageInfo{
			MessageSource: types.MessageSource{Chat: sender, Sender: sender},
			ID:            "MSG1",
			Timestamp:     time.Unix(1700000000, 0),
		},
		Message: msg,
	}
}

func TestBuildMessageDataFlowResponse(t *testing.T) {
	const params = `{"flow_token":"tok-1","name":"Maria"}`
	evt := messageEvent(&waE2E.Message{
		InteractiveResponseMessage: &waE2E.InteractiveResponseMessage{
			Body: &waE2E.InteractiveResponseMessage_Body{Text: proto.String("Sent")},
			InteractiveResponseMessage: &waE2E.InteractiveResponseMessage_NativeFlowResponseMessage_{
				NativeFlowResponseMessage: &waE2E.InteractiveResponseMessage_NativeFlowResponseMessage{
					Name:       proto.String("flow"),
					ParamsJSON: proto.String(params),
				},
			},
		},
	})

	data := BuildMessageData(nil, evt, zerolog.Nop())
	if data.Type != "interactive" {
		t.Fatalf("type = %q, want interactive", data.Type)
	}
	if data.FlowResponse == nil {
		t.Fatal("flow_response missing")
	}

	raw, err := json.Marshal(data)
	if err != nil {
		t.Fatal(err)
	}
	var decoded struct {
		Type         string `json:"type"`
		FlowResponse struct {
			Name       string `json:"name"`
			ParamsJSON string `json:"params_json"`
			Body       string `json:"body"`
		} `json:"flow_response"`
	}
	if err := json.Unmarshal(raw, &decoded); err != nil {
		t.Fatal(err)
	}
	fr := decoded.FlowResponse
	if fr.Name != "flow" || fr.ParamsJSON != params || fr.Body != "Sent" {
		t.Fatalf("unexpected flow_response in %s", raw)
	}
}

func TestBuildMessageDataOmitsFlowResponse(t *testing.T) {
	data := BuildMessageData(nil, messageEvent(&waE2E.Message{Conversation: proto.String("oi")}), zerolog.Nop())
	if data.Type != "text" || data.FlowResponse != nil {
		t.Fatalf("unexpected data: %+v", data)
	}
	raw, _ := json.Marshal(data)
	var m map[string]any
	_ = json.Unmarshal(raw, &m)
	if _, ok := m["flow_response"]; ok {
		t.Fatalf("flow_response should be omitted: %s", raw)
	}
}
