package whatsapp

import (
	"context"
	"encoding/base64"

	"github.com/rs/zerolog"
	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/types/events"
)

// Webhook event type constants
const (
	EventConnectionStatus = "CONNECTION_STATUS"
	EventMessage          = "MESSAGE"
	EventMessageStatus    = "MESSAGE_STATUS"
	EventGroupMembersEdit = "GROUP_MEMBERS_EDIT"
)

type EventHandler struct {
	InstanceID         string
	Logger             zerolog.Logger
	OnConnected        func()
	OnDisconnected     func()
	OnPairSuccess      func(phone string)
	OnQR               func(codes []string)
	OnMessage          func(evt *events.Message)
	OnReceipt          func(evt *events.Receipt)
	OnGroupMembersEdit func(evt *events.GroupInfo)
}

func (h *EventHandler) Handle(evt interface{}) {
	switch v := evt.(type) {
	case *events.Connected:
		h.Logger.Info().Msg("WhatsApp connected")
		if h.OnConnected != nil {
			h.OnConnected()
		}

	case *events.Disconnected:
		h.Logger.Warn().Msg("WhatsApp disconnected")
		if h.OnDisconnected != nil {
			h.OnDisconnected()
		}

	case *events.QR:
		h.Logger.Info().Int("count", len(v.Codes)).Msg("QR code received")
		if h.OnQR != nil {
			h.OnQR(v.Codes)
		}

	case *events.Message:
		h.Logger.Debug().
			Str("from", v.Info.Sender.String()).
			Str("chat", v.Info.Chat.String()).
			Str("message_id", v.Info.ID).
			Msg("message received")
		if h.OnMessage != nil {
			h.OnMessage(v)
		}

	case *events.Receipt:
		h.Logger.Debug().
			Str("type", string(v.Type)).
			Msg("receipt received")
		if h.OnReceipt != nil {
			h.OnReceipt(v)
		}

	case *events.LoggedOut:
		h.Logger.Warn().
			Int("reason", int(v.Reason)).
			Msg("logged out")
		if h.OnDisconnected != nil {
			h.OnDisconnected()
		}

	case *events.PairSuccess:
		h.Logger.Info().
			Str("jid", v.ID.String()).
			Msg("pairing successful")
		if h.OnPairSuccess != nil {
			h.OnPairSuccess(v.ID.User)
		}
		if h.OnConnected != nil {
			h.OnConnected()
		}

	case *events.PairError:
		h.Logger.Error().
			Str("error", v.Error.Error()).
			Msg("pairing failed")
		if h.OnDisconnected != nil {
			h.OnDisconnected()
		}

	case *events.GroupInfo:
		if v.Join != nil || v.Leave != nil || v.Promote != nil || v.Demote != nil {
			h.Logger.Info().
				Str("group", v.JID.String()).
				Msg("group members changed")
			if h.OnGroupMembersEdit != nil {
				h.OnGroupMembersEdit(v)
			}
		}
	}
}

// ── Webhook payload structures ──

type ConnectionStatusData struct {
	InstanceID string `json:"instance_id"`
	Status     string `json:"status"` // connected, disconnected
}

type MessageData struct {
	MessageID   string `json:"message_id"`
	From        string `json:"from"`
	Chat        string `json:"chat"`
	IsGroup     bool   `json:"is_group"`
	Timestamp   int64  `json:"timestamp"`
	Type        string `json:"type"` // text, image, video, audio, document, sticker, poll, other
	Text        string `json:"text,omitempty"`
	HasMedia    bool   `json:"has_media"`
	MimeType    string `json:"mime_type,omitempty"`
	FileName    string `json:"file_name,omitempty"`
	MediaBase64 string `json:"media_base64,omitempty"`
}

type MessageStatusData struct {
	MessageIDs []string `json:"message_ids"`
	From       string   `json:"from"`
	Chat       string   `json:"chat"`
	Status     string   `json:"status"` // sent, delivered, read, played
	Timestamp  int64    `json:"timestamp"`
}

func BuildMessageStatusData(client *whatsmeow.Client, evt *events.Receipt) MessageStatusData {
	ids := make([]string, len(evt.MessageIDs))
	for i, id := range evt.MessageIDs {
		ids[i] = string(id)
	}

	status := "delivered"
	switch evt.Type {
	case "read":
		status = "read"
	case "read-self":
		status = "read"
	case "played":
		status = "played"
	case "played-self":
		status = "played"
	case "sender":
		status = "sent"
	case "":
		status = "delivered"
	}

	return MessageStatusData{
		MessageIDs: ids,
		From:       resolveJID(client, evt.MessageSource.Sender),
		Chat:       evt.MessageSource.Chat.String(),
		Status:     status,
		Timestamp:  evt.Timestamp.Unix(),
	}
}

type GroupMembersEditData struct {
	GroupJID     string           `json:"group_jid"`
	Action       string           `json:"action"` // join, leave, promote, demote
	Participants []string         `json:"participants"`
	Actor        string           `json:"actor,omitempty"`
}

func BuildMessageData(client *whatsmeow.Client, evt *events.Message, log zerolog.Logger) MessageData {
	data := MessageData{
		MessageID: evt.Info.ID,
		From:      resolveJID(client, evt.Info.Sender),
		Chat:      evt.Info.Chat.String(),
		IsGroup:   evt.Info.IsGroup,
		Timestamp: evt.Info.Timestamp.Unix(),
		Type:      "other",
	}

	msg := evt.Message

	switch {
	case msg.GetConversation() != "":
		data.Type = "text"
		data.Text = msg.GetConversation()
	case msg.GetExtendedTextMessage() != nil:
		data.Type = "text"
		data.Text = msg.GetExtendedTextMessage().GetText()
	case msg.GetImageMessage() != nil:
		data.Type = "image"
		data.HasMedia = true
		data.MimeType = msg.GetImageMessage().GetMimetype()
		data.Text = msg.GetImageMessage().GetCaption()
		data.MediaBase64 = downloadAndEncode(client, msg.GetImageMessage(), log)
	case msg.GetVideoMessage() != nil:
		data.Type = "video"
		data.HasMedia = true
		data.MimeType = msg.GetVideoMessage().GetMimetype()
		data.Text = msg.GetVideoMessage().GetCaption()
		data.MediaBase64 = downloadAndEncode(client, msg.GetVideoMessage(), log)
	case msg.GetAudioMessage() != nil:
		data.Type = "audio"
		data.HasMedia = true
		data.MimeType = msg.GetAudioMessage().GetMimetype()
		data.MediaBase64 = downloadAndEncode(client, msg.GetAudioMessage(), log)
	case msg.GetDocumentMessage() != nil:
		data.Type = "document"
		data.HasMedia = true
		data.MimeType = msg.GetDocumentMessage().GetMimetype()
		data.Text = msg.GetDocumentMessage().GetCaption()
		data.FileName = msg.GetDocumentMessage().GetFileName()
		data.MediaBase64 = downloadAndEncode(client, msg.GetDocumentMessage(), log)
	case msg.GetStickerMessage() != nil:
		data.Type = "sticker"
		data.HasMedia = true
		data.MimeType = msg.GetStickerMessage().GetMimetype()
		data.MediaBase64 = downloadAndEncode(client, msg.GetStickerMessage(), log)
	case msg.GetPollCreationMessage() != nil:
		data.Type = "poll"
		data.Text = msg.GetPollCreationMessage().GetName()
	}

	return data
}

// resolveJID converts a LID JID to a phone number JID if possible, using the whatsmeow store
func resolveJID(client *whatsmeow.Client, jid types.JID) string {
	if jid.Server == "lid" && client.Store.LIDs != nil {
		pn, err := client.Store.LIDs.GetPNForLID(context.Background(), jid)
		if err == nil && !pn.IsEmpty() {
			return pn.String()
		}
	}
	return jid.String()
}

// downloadAndEncode downloads and decrypts media from WhatsApp, returns base64 encoded string
func downloadAndEncode(client *whatsmeow.Client, msg whatsmeow.DownloadableMessage, log zerolog.Logger) string {
	data, err := client.Download(context.Background(), msg)
	if err != nil {
		log.Warn().Err(err).Msg("failed to download media")
		return ""
	}
	return base64.StdEncoding.EncodeToString(data)
}

func BuildGroupMembersEditData(evt *events.GroupInfo) []GroupMembersEditData {
	var edits []GroupMembersEditData

	if evt.Join != nil {
		jids := make([]string, len(evt.Join))
		for i, j := range evt.Join {
			jids[i] = j.String()
		}
		edits = append(edits, GroupMembersEditData{
			GroupJID:     evt.JID.String(),
			Action:       "join",
			Participants: jids,
		})
	}

	if evt.Leave != nil {
		jids := make([]string, len(evt.Leave))
		for i, j := range evt.Leave {
			jids[i] = j.String()
		}
		edits = append(edits, GroupMembersEditData{
			GroupJID:     evt.JID.String(),
			Action:       "leave",
			Participants: jids,
		})
	}

	if evt.Promote != nil {
		jids := make([]string, len(evt.Promote))
		for i, j := range evt.Promote {
			jids[i] = j.String()
		}
		edits = append(edits, GroupMembersEditData{
			GroupJID:     evt.JID.String(),
			Action:       "promote",
			Participants: jids,
		})
	}

	if evt.Demote != nil {
		jids := make([]string, len(evt.Demote))
		for i, j := range evt.Demote {
			jids[i] = j.String()
		}
		edits = append(edits, GroupMembersEditData{
			GroupJID:     evt.JID.String(),
			Action:       "demote",
			Participants: jids,
		})
	}

	return edits
}
