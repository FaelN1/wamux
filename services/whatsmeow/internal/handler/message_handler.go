package handler

import (
	"net/url"

	"wamux_go/internal/instance"
	"wamux_go/internal/middleware"
	"wamux_go/internal/whatsapp"

	"github.com/gofiber/fiber/v2"
)

type MessageHandler struct {
	manager *instance.Manager
}

func NewMessageHandler(manager *instance.Manager) *MessageHandler {
	return &MessageHandler{manager: manager}
}

// POST /api/v1/message/text
func (h *MessageHandler) SendText(c *fiber.Ctx) error {
	inst := middleware.GetInstance(c)
	if inst == nil {
		return unauthorizedResponse(c)
	}

	if inst.Status != instance.StatusConnected {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error":   "instance_not_connected",
			"message": "Instance is not connected to WhatsApp.",
			"status":  400,
		})
	}

	var req struct {
		To      string `json:"to"`
		Text    string `json:"text"`
		ReplyTo string `json:"reply_to"`
	}
	if err := c.BodyParser(&req); err != nil {
		return invalidRequestResponse(c, "Invalid request body.")
	}

	if req.To == "" || req.Text == "" {
		return invalidRequestResponse(c, "to and text are required.")
	}

	client, err := h.manager.GetClient(inst.ID)
	if err != nil {
		return internalErrorResponse(c, err.Error())
	}

	msgID, err := client.SendText(req.To, req.Text, req.ReplyTo)
	if err != nil {
		h.manager.GetMsgLog().LogOutgoing(c.Context(), inst.ID, "", req.To, "text", req.Text, false, "", "error", err.Error())
		return internalErrorResponse(c, err.Error())
	}

	h.manager.GetMsgLog().LogOutgoing(c.Context(), inst.ID, msgID, req.To, "text", req.Text, false, "", "sent", "")
	return c.JSON(fiber.Map{
		"message_id": msgID,
		"status":     "sent",
	})
}

// POST /api/v1/message/media
func (h *MessageHandler) SendMedia(c *fiber.Ctx) error {
	inst := middleware.GetInstance(c)
	if inst == nil {
		return unauthorizedResponse(c)
	}

	if inst.Status != instance.StatusConnected {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error":   "instance_not_connected",
			"message": "Instance is not connected to WhatsApp.",
			"status":  400,
		})
	}

	var req whatsapp.MediaRequest
	if err := c.BodyParser(&req); err != nil {
		return invalidRequestResponse(c, "Invalid request body.")
	}

	if req.To == "" || req.URL == "" || req.Type == "" {
		return invalidRequestResponse(c, "to, url, and type are required.")
	}

	client, err := h.manager.GetClient(inst.ID)
	if err != nil {
		return internalErrorResponse(c, err.Error())
	}

	msgID, err := client.SendMedia(req)
	if err != nil {
		h.manager.GetMsgLog().LogOutgoing(c.Context(), inst.ID, "", req.To, req.Type, req.Caption, true, req.MimeType, "error", err.Error())
		return internalErrorResponse(c, err.Error())
	}

	h.manager.GetMsgLog().LogOutgoing(c.Context(), inst.ID, msgID, req.To, req.Type, req.Caption, true, req.MimeType, "sent", "")
	return c.JSON(fiber.Map{
		"message_id": msgID,
		"status":     "sent",
	})
}

// POST /api/v1/message/poll
func (h *MessageHandler) SendPoll(c *fiber.Ctx) error {
	inst := middleware.GetInstance(c)
	if inst == nil {
		return unauthorizedResponse(c)
	}

	if inst.Status != instance.StatusConnected {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error":   "instance_not_connected",
			"message": "Instance is not connected to WhatsApp.",
			"status":  400,
		})
	}

	var req whatsapp.PollRequest
	if err := c.BodyParser(&req); err != nil {
		return invalidRequestResponse(c, "Invalid request body.")
	}

	if req.To == "" || req.Question == "" || len(req.Options) < 2 {
		return invalidRequestResponse(c, "to, question, and at least 2 options are required.")
	}

	client, err := h.manager.GetClient(inst.ID)
	if err != nil {
		return internalErrorResponse(c, err.Error())
	}

	msgID, err := client.SendPoll(req)
	if err != nil {
		return internalErrorResponse(c, err.Error())
	}

	return c.JSON(fiber.Map{
		"message_id": msgID,
		"status":     "sent",
	})
}

// POST /api/v1/message/status
func (h *MessageHandler) SendStatus(c *fiber.Ctx) error {
	inst := middleware.GetInstance(c)
	if inst == nil {
		return unauthorizedResponse(c)
	}

	if inst.Status != instance.StatusConnected {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error":   "instance_not_connected",
			"message": "Instance is not connected to WhatsApp.",
			"status":  400,
		})
	}

	var req whatsapp.StatusRequest
	if err := c.BodyParser(&req); err != nil {
		return invalidRequestResponse(c, "Invalid request body.")
	}

	if req.Type == "" || req.Type == "text" {
		if req.Text == "" {
			return invalidRequestResponse(c, "text is required for a text status.")
		}
	} else if req.URL == "" {
		return invalidRequestResponse(c, "url is required for a media status.")
	}

	client, err := h.manager.GetClient(inst.ID)
	if err != nil {
		return internalErrorResponse(c, err.Error())
	}

	msgID, err := client.SendStatus(req)
	if err != nil {
		return internalErrorResponse(c, err.Error())
	}

	return c.JSON(fiber.Map{
		"message_id": msgID,
		"status":     "sent",
	})
}

// POST /api/v1/message/react
func (h *MessageHandler) React(c *fiber.Ctx) error {
	inst := middleware.GetInstance(c)
	if inst == nil {
		return unauthorizedResponse(c)
	}

	if inst.Status != instance.StatusConnected {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error":   "instance_not_connected",
			"message": "Instance is not connected to WhatsApp.",
			"status":  400,
		})
	}

	var req struct {
		To        string `json:"to"`
		MessageID string `json:"message_id"`
		Emoji     string `json:"emoji"`
		FromMe    bool   `json:"from_me"`
		Sender    string `json:"sender"`
	}
	if err := c.BodyParser(&req); err != nil {
		return invalidRequestResponse(c, "Invalid request body.")
	}

	if req.To == "" || req.MessageID == "" {
		return invalidRequestResponse(c, "to and message_id are required.")
	}

	client, err := h.manager.GetClient(inst.ID)
	if err != nil {
		return internalErrorResponse(c, err.Error())
	}

	msgID, err := client.React(req.To, req.MessageID, req.Sender, req.Emoji, req.FromMe)
	if err != nil {
		return internalErrorResponse(c, err.Error())
	}

	return c.JSON(fiber.Map{
		"message_id": msgID,
		"status":     "sent",
	})
}

// POST /api/v1/message/edit
func (h *MessageHandler) Edit(c *fiber.Ctx) error {
	inst := middleware.GetInstance(c)
	if inst == nil {
		return unauthorizedResponse(c)
	}

	if inst.Status != instance.StatusConnected {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error":   "instance_not_connected",
			"message": "Instance is not connected to WhatsApp.",
			"status":  400,
		})
	}

	var req struct {
		To        string `json:"to"`
		MessageID string `json:"message_id"`
		Text      string `json:"text"`
	}
	if err := c.BodyParser(&req); err != nil {
		return invalidRequestResponse(c, "Invalid request body.")
	}

	if req.To == "" || req.MessageID == "" || req.Text == "" {
		return invalidRequestResponse(c, "to, message_id and text are required.")
	}

	client, err := h.manager.GetClient(inst.ID)
	if err != nil {
		return internalErrorResponse(c, err.Error())
	}

	msgID, err := client.Edit(req.To, req.MessageID, req.Text)
	if err != nil {
		return internalErrorResponse(c, err.Error())
	}

	return c.JSON(fiber.Map{
		"message_id": msgID,
		"status":     "sent",
	})
}

// POST /api/v1/message/location
func (h *MessageHandler) SendLocation(c *fiber.Ctx) error {
	inst := middleware.GetInstance(c)
	if inst == nil {
		return unauthorizedResponse(c)
	}

	if inst.Status != instance.StatusConnected {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error":   "instance_not_connected",
			"message": "Instance is not connected to WhatsApp.",
			"status":  400,
		})
	}

	var req whatsapp.LocationRequest
	if err := c.BodyParser(&req); err != nil {
		return invalidRequestResponse(c, "Invalid request body.")
	}

	if req.To == "" {
		return invalidRequestResponse(c, "to is required.")
	}

	client, err := h.manager.GetClient(inst.ID)
	if err != nil {
		return internalErrorResponse(c, err.Error())
	}

	msgID, err := client.SendLocation(req)
	if err != nil {
		return internalErrorResponse(c, err.Error())
	}

	return c.JSON(fiber.Map{
		"message_id": msgID,
		"status":     "sent",
	})
}

// POST /api/v1/message/contact
func (h *MessageHandler) SendContact(c *fiber.Ctx) error {
	inst := middleware.GetInstance(c)
	if inst == nil {
		return unauthorizedResponse(c)
	}

	if inst.Status != instance.StatusConnected {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error":   "instance_not_connected",
			"message": "Instance is not connected to WhatsApp.",
			"status":  400,
		})
	}

	var req whatsapp.ContactRequest
	if err := c.BodyParser(&req); err != nil {
		return invalidRequestResponse(c, "Invalid request body.")
	}

	if req.To == "" || len(req.Contacts) == 0 {
		return invalidRequestResponse(c, "to and contacts are required.")
	}

	client, err := h.manager.GetClient(inst.ID)
	if err != nil {
		return internalErrorResponse(c, err.Error())
	}

	msgID, err := client.SendContact(req)
	if err != nil {
		return internalErrorResponse(c, err.Error())
	}

	return c.JSON(fiber.Map{
		"message_id": msgID,
		"status":     "sent",
	})
}

// DELETE /api/v1/message
func (h *MessageHandler) Delete(c *fiber.Ctx) error {
	inst := middleware.GetInstance(c)
	if inst == nil {
		return unauthorizedResponse(c)
	}

	if inst.Status != instance.StatusConnected {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error":   "instance_not_connected",
			"message": "Instance is not connected to WhatsApp.",
			"status":  400,
		})
	}

	var req struct {
		To          string   `json:"to"`
		MessageIDs  []string `json:"message_ids"`
		ForEveryone bool     `json:"for_everyone"`
	}
	if err := c.BodyParser(&req); err != nil {
		return invalidRequestResponse(c, "Invalid request body.")
	}

	if req.To == "" || len(req.MessageIDs) == 0 {
		return invalidRequestResponse(c, "to and message_ids are required.")
	}

	client, err := h.manager.GetClient(inst.ID)
	if err != nil {
		return internalErrorResponse(c, err.Error())
	}

	success, failed, err := client.DeleteMessages(req.To, req.MessageIDs, req.ForEveryone)
	if err != nil {
		return internalErrorResponse(c, err.Error())
	}

	return c.JSON(fiber.Map{
		"success": success,
		"failed":  failed,
	})
}

// GET /api/v1/message/history
func (h *MessageHandler) History(c *fiber.Ctx) error {
	inst := middleware.GetInstance(c)
	if inst == nil {
		return unauthorizedResponse(c)
	}

	limit := c.QueryInt("limit", 50)
	offset := c.QueryInt("offset", 0)
	if limit > 200 {
		limit = 200
	}

	entries, total, err := h.manager.GetMsgLog().GetHistory(c.Context(), inst.ID, limit, offset)
	if err != nil {
		return internalErrorResponse(c, err.Error())
	}

	return c.JSON(fiber.Map{
		"messages": entries,
		"total":    total,
		"limit":    limit,
		"offset":   offset,
	})
}

// GET /api/v1/message/stats
func (h *MessageHandler) Stats(c *fiber.Ctx) error {
	inst := middleware.GetInstance(c)
	if inst == nil {
		return unauthorizedResponse(c)
	}

	stats, err := h.manager.GetMsgLog().GetStats(c.Context(), inst.ID)
	if err != nil {
		return internalErrorResponse(c, err.Error())
	}

	return c.JSON(stats)
}

func unauthorizedResponse(c *fiber.Ctx) error {
	return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
		"error":   "unauthorized",
		"message": "Instance not found.",
		"status":  401,
	})
}

func invalidRequestResponse(c *fiber.Ctx, msg string) error {
	return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
		"error":   "invalid_request",
		"message": msg,
		"status":  400,
	})
}

func decodeParam(c *fiber.Ctx, name string) string {
	v := c.Params(name)
	decoded, err := url.PathUnescape(v)
	if err != nil {
		return v
	}
	return decoded
}

func internalErrorResponse(c *fiber.Ctx, msg string) error {
	return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
		"error":   "internal_error",
		"message": msg,
		"status":  500,
	})
}

// ── interativos ─────────────────────────────────────────────

// POST /api/v1/message/buttons
func (h *MessageHandler) SendButtons(c *fiber.Ctx) error {
	client, inst, errResp := h.connectedClient(c)
	if errResp != nil {
		return errResp
	}

	var req whatsapp.ButtonsRequest
	if err := c.BodyParser(&req); err != nil {
		return invalidRequestResponse(c, "Invalid request body.")
	}
	if req.To == "" || req.Text == "" || len(req.Buttons) == 0 {
		return invalidRequestResponse(c, "to, text and buttons are required.")
	}

	msgID, err := client.SendButtons(req)
	if err != nil {
		h.manager.GetMsgLog().LogOutgoing(c.Context(), inst.ID, "", req.To, "buttons", req.Text, false, "", "error", err.Error())
		return internalErrorResponse(c, err.Error())
	}
	h.manager.GetMsgLog().LogOutgoing(c.Context(), inst.ID, msgID, req.To, "buttons", req.Text, false, "", "sent", "")
	return c.JSON(fiber.Map{"message_id": msgID, "status": "sent"})
}

// POST /api/v1/message/list
func (h *MessageHandler) SendList(c *fiber.Ctx) error {
	client, inst, errResp := h.connectedClient(c)
	if errResp != nil {
		return errResp
	}

	var req whatsapp.ListRequest
	if err := c.BodyParser(&req); err != nil {
		return invalidRequestResponse(c, "Invalid request body.")
	}
	if req.To == "" || req.Text == "" || req.ButtonText == "" || len(req.Sections) == 0 {
		return invalidRequestResponse(c, "to, text, button_text and sections are required.")
	}

	msgID, err := client.SendList(req)
	if err != nil {
		h.manager.GetMsgLog().LogOutgoing(c.Context(), inst.ID, "", req.To, "list", req.Text, false, "", "error", err.Error())
		return internalErrorResponse(c, err.Error())
	}
	h.manager.GetMsgLog().LogOutgoing(c.Context(), inst.ID, msgID, req.To, "list", req.Text, false, "", "sent", "")
	return c.JSON(fiber.Map{"message_id": msgID, "status": "sent"})
}

// POST /api/v1/message/pix
func (h *MessageHandler) SendPix(c *fiber.Ctx) error {
	client, inst, errResp := h.connectedClient(c)
	if errResp != nil {
		return errResp
	}

	var req whatsapp.PixRequest
	if err := c.BodyParser(&req); err != nil {
		return invalidRequestResponse(c, "Invalid request body.")
	}
	if req.To == "" || req.Key == "" || req.Merchant == "" {
		return invalidRequestResponse(c, "to, key and merchant are required.")
	}

	msgID, err := client.SendPix(req)
	if err != nil {
		h.manager.GetMsgLog().LogOutgoing(c.Context(), inst.ID, "", req.To, "pix", req.Merchant, false, "", "error", err.Error())
		return internalErrorResponse(c, err.Error())
	}
	h.manager.GetMsgLog().LogOutgoing(c.Context(), inst.ID, msgID, req.To, "pix", req.Merchant, false, "", "sent", "")
	return c.JSON(fiber.Map{"message_id": msgID, "status": "sent"})
}

// connectedClient resolves the instance and its live client, returning the
// error response to bubble up when either is missing. The three interactive
// handlers share the exact same preamble.
func (h *MessageHandler) connectedClient(c *fiber.Ctx) (*whatsapp.Client, *instance.Instance, error) {
	inst := middleware.GetInstance(c)
	if inst == nil {
		return nil, nil, unauthorizedResponse(c)
	}
	if inst.Status != instance.StatusConnected {
		return nil, nil, c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error":   "instance_not_connected",
			"message": "Instance is not connected to WhatsApp.",
			"status":  400,
		})
	}
	client, err := h.manager.GetClient(inst.ID)
	if err != nil {
		return nil, nil, internalErrorResponse(c, err.Error())
	}
	return client, inst, nil
}
