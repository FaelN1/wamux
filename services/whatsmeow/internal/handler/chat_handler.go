package handler

import (
	"context"

	"wamux_go/internal/chat"
	"wamux_go/internal/instance"
	"wamux_go/internal/middleware"
	"wamux_go/internal/whatsapp"

	"github.com/gofiber/fiber/v2"
	wmeow "go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/types"
)

type ChatHandler struct {
	manager   *instance.Manager
	chatStore *chat.Store
}

func NewChatHandler(manager *instance.Manager, chatStore *chat.Store) *ChatHandler {
	return &ChatHandler{manager: manager, chatStore: chatStore}
}


func (h *ChatHandler) getClient(c *fiber.Ctx) (*instance.Instance, *whatsapp.Client, error) {
	inst := middleware.GetInstance(c)
	if inst == nil {
		return nil, nil, unauthorizedResponse(c)
	}
	if inst.Status != instance.StatusConnected {
		return nil, nil, invalidRequestResponse(c, "Instance is not connected.")
	}
	client, err := h.manager.GetClient(inst.ID)
	if err != nil {
		return nil, nil, internalErrorResponse(c, err.Error())
	}
	return inst, client, nil
}

// GET /api/v1/chat - List chats
func (h *ChatHandler) ListChats(c *fiber.Ctx) error {
	inst := middleware.GetInstance(c)
	if inst == nil {
		return unauthorizedResponse(c)
	}

	limit := c.QueryInt("limit", 50)
	offset := c.QueryInt("offset", 0)
	search := c.Query("search")

	if search != "" {
		contacts, err := h.chatStore.Search(c.Context(), inst.ID, search, limit)
		if err != nil {
			return internalErrorResponse(c, err.Error())
		}
		return c.JSON(fiber.Map{"chats": contacts, "total": len(contacts)})
	}

	contacts, total, err := h.chatStore.ListChats(c.Context(), inst.ID, limit, offset)
	if err != nil {
		return internalErrorResponse(c, err.Error())
	}

	return c.JSON(fiber.Map{"chats": contacts, "total": total, "limit": limit, "offset": offset})
}

// GET /api/v1/chat/:jid/messages - Get messages for a chat
func (h *ChatHandler) GetMessages(c *fiber.Ctx) error {
	inst := middleware.GetInstance(c)
	if inst == nil {
		return unauthorizedResponse(c)
	}

	jid := decodeParam(c, "jid")
	limit := c.QueryInt("limit", 50)
	offset := c.QueryInt("offset", 0)

	// Mark chat as read
	h.chatStore.MarkRead(c.Context(), inst.ID, jid)

	entries, total, err := h.manager.GetMsgLog().GetChatHistory(c.Context(), inst.ID, jid, limit, offset)
	if err != nil {
		return internalErrorResponse(c, err.Error())
	}

	return c.JSON(fiber.Map{"messages": entries, "total": total, "limit": limit, "offset": offset})
}

// POST /api/v1/chat/:jid/send - Send message from chat UI
func (h *ChatHandler) SendMessage(c *fiber.Ctx) error {
	inst, client, err := h.getClient(c)
	if err != nil {
		return err
	}

	jid := decodeParam(c, "jid")
	var req struct {
		Text string `json:"text"`
	}
	if err := c.BodyParser(&req); err != nil || req.Text == "" {
		return invalidRequestResponse(c, "text is required.")
	}

	msgID, err := client.SendText(jid, req.Text, "")
	if err != nil {
		h.manager.GetMsgLog().LogOutgoing(c.Context(), inst.ID, "", jid, "text", req.Text, false, "", "error", err.Error())
		return internalErrorResponse(c, err.Error())
	}

	h.manager.GetMsgLog().LogOutgoing(c.Context(), inst.ID, msgID, jid, "text", req.Text, false, "", "sent", "")

	// Update contact last message
	phone := ""
	if p := types.NewJID(jid, "").User; p != "" {
		phone = p
	}
	h.chatStore.Upsert(c.Context(), inst.ID, jid, "", phone, false, req.Text, false)

	return c.JSON(fiber.Map{"message_id": msgID, "status": "sent"})
}

// POST /api/v1/chat/:jid/upload - Send media file from upload
func (h *ChatHandler) SendMedia(c *fiber.Ctx) error {
	inst, client, err := h.getClient(c)
	if err != nil {
		return err
	}

	jid := decodeParam(c, "jid")
	caption := c.FormValue("caption")

	file, err := c.FormFile("file")
	if err != nil {
		return invalidRequestResponse(c, "file is required. Use multipart/form-data with field 'file'.")
	}

	// Read file
	f, err := file.Open()
	if err != nil {
		return internalErrorResponse(c, "failed to open file")
	}
	defer f.Close()

	data := make([]byte, file.Size)
	if _, err := f.Read(data); err != nil {
		return internalErrorResponse(c, "failed to read file")
	}

	// Detect media type from MIME
	mimeType := file.Header.Get("Content-Type")
	mediaType := "document"
	switch {
	case len(mimeType) > 6 && mimeType[:6] == "image/":
		mediaType = "image"
	case len(mimeType) > 6 && mimeType[:6] == "video/":
		mediaType = "video"
	case len(mimeType) > 6 && mimeType[:6] == "audio/":
		mediaType = "audio"
	}

	msgID, err := client.SendMediaBytes(jid, data, mediaType, mimeType, caption, file.Filename)
	if err != nil {
		h.manager.GetMsgLog().LogOutgoing(c.Context(), inst.ID, "", jid, mediaType, caption, true, mimeType, "error", err.Error())
		return internalErrorResponse(c, err.Error())
	}

	preview := caption
	if preview == "" {
		preview = "[" + mediaType + "] " + file.Filename
	}
	h.manager.GetMsgLog().LogOutgoing(c.Context(), inst.ID, msgID, jid, mediaType, caption, true, mimeType, "sent", "")
	h.chatStore.Upsert(c.Context(), inst.ID, jid, "", "", false, preview, false)

	return c.JSON(fiber.Map{"message_id": msgID, "status": "sent", "type": mediaType})
}

// GET /api/v1/contact/:jid - Fetch WhatsApp profile info
func (h *ChatHandler) GetContactProfile(c *fiber.Ctx) error {
	inst, client, err := h.getClient(c)
	if err != nil {
		return err
	}

	jidStr := c.Params("jid")
	jid, parseErr := types.ParseJID(jidStr)
	if parseErr != nil {
		return invalidRequestResponse(c, "Invalid JID.")
	}

	ctx := context.Background()

	// Get user info
	var name, statusText, pictureURL string
	userInfo, err := client.WAClient.GetUserInfo(ctx, []types.JID{jid})
	if err == nil {
		if ui, ok := userInfo[jid]; ok {
			statusText = ui.Status
		}
	}

	// Get profile picture
	pic, err := client.WAClient.GetProfilePictureInfo(ctx, jid, &wmeow.GetProfilePictureParams{})
	if err == nil && pic != nil {
		pictureURL = pic.URL
	}

	// Try to get push name from contact store
	existing, _ := h.chatStore.GetContact(ctx, inst.ID, jidStr)
	if existing != nil && existing.Name != "" {
		name = existing.Name
	}

	// Update contact in DB
	h.chatStore.UpdateProfile(ctx, inst.ID, jidStr, name, pictureURL, statusText)

	// If no existing contact, create one
	if existing == nil {
		phone := jid.User
		h.chatStore.Upsert(ctx, inst.ID, jidStr, name, phone, jid.Server == "g.us", "", false)
	}

	// Re-fetch
	contact, _ := h.chatStore.GetContact(ctx, inst.ID, jidStr)
	if contact == nil {
		return c.JSON(fiber.Map{
			"jid": jidStr, "name": name, "picture_url": pictureURL,
			"status_text": statusText, "phone": jid.User,
		})
	}

	return c.JSON(contact)
}

// POST /api/v1/chat/:jid/read - Mark chat as read
func (h *ChatHandler) MarkRead(c *fiber.Ctx) error {
	inst := middleware.GetInstance(c)
	if inst == nil {
		return unauthorizedResponse(c)
	}

	jid := decodeParam(c, "jid")
	h.chatStore.MarkRead(c.Context(), inst.ID, jid)
	return c.JSON(fiber.Map{"status": "ok"})
}
