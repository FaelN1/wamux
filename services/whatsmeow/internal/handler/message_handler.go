package handler

import (
	"net/url"
	"time"

	"wamux_go/internal/instance"
	"wamux_go/internal/middleware"
	"wamux_go/internal/msgqueue"
	"wamux_go/internal/whatsapp"

	"github.com/gofiber/fiber/v2"
)

type MessageHandler struct {
	manager *instance.Manager
	queue   *msgqueue.Queue
}

func NewMessageHandler(manager *instance.Manager, queue *msgqueue.Queue) *MessageHandler {
	return &MessageHandler{manager: manager, queue: queue}
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

	if req.Text == "" {
		return invalidRequestResponse(c, "text is required.")
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

// POST /api/v1/message/broadcast
func (h *MessageHandler) Broadcast(c *fiber.Ctx) error {
	inst := middleware.GetInstance(c)
	if inst == nil {
		return unauthorizedResponse(c)
	}
	if inst.Status != instance.StatusConnected {
		return invalidRequestResponse(c, "Instance is not connected.")
	}

	var req struct {
		Recipients []string `json:"recipients"` // list of JIDs
		Text       string   `json:"text"`
		DelayMs    int      `json:"delay_ms"` // delay between sends in ms, default 2000
	}
	if err := c.BodyParser(&req); err != nil {
		return invalidRequestResponse(c, "Invalid request body.")
	}
	if len(req.Recipients) == 0 || req.Text == "" {
		return invalidRequestResponse(c, "recipients and text are required.")
	}

	delay := time.Duration(req.DelayMs) * time.Millisecond
	if delay < 1*time.Second {
		delay = 2 * time.Second
	}

	// Build payloads for each recipient
	var payloads []interface{}
	for _, to := range req.Recipients {
		payloads = append(payloads, map[string]string{"to": to, "text": req.Text})
	}

	ids, err := h.queue.EnqueueBatch(c.Context(), inst.ID, "text", payloads, delay)
	if err != nil {
		return internalErrorResponse(c, err.Error())
	}

	return c.Status(fiber.StatusAccepted).JSON(fiber.Map{
		"status":     "queued",
		"total":      len(ids),
		"queue_ids":  ids,
		"delay_ms":   delay.Milliseconds(),
		"message":    "Messages queued for sending. Use GET /api/v1/message/queue/:id to check status.",
	})
}

// GET /api/v1/message/queue/:id
func (h *MessageHandler) QueueStatus(c *fiber.Ctx) error {
	inst := middleware.GetInstance(c)
	if inst == nil {
		return unauthorizedResponse(c)
	}

	id := c.Params("id")
	msg, err := h.queue.GetStatus(c.Context(), id)
	if err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": "not_found", "message": err.Error(), "status": 404,
		})
	}

	return c.JSON(msg)
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
