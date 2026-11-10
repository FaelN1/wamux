package handler

import (
	"wamux_go/internal/instance"
	"wamux_go/internal/middleware"
	"wamux_go/internal/whatsapp"

	"github.com/gofiber/fiber/v2"
)

type LabelHandler struct {
	manager *instance.Manager
}

func NewLabelHandler(manager *instance.Manager) *LabelHandler {
	return &LabelHandler{manager: manager}
}

// getConnectedClient resolves the instance + live client for the request, writing
// the appropriate error response itself. The boolean return is the ONLY signal
// callers should use to decide whether to proceed — see the identical comment on
// GroupHandler.getConnectedClient for why the previous `error` return was unsafe.
func (h *LabelHandler) getConnectedClient(c *fiber.Ctx) (*instance.Instance, *whatsapp.Client, bool) {
	inst := middleware.GetInstance(c)
	if inst == nil {
		_ = unauthorizedResponse(c)
		return nil, nil, false
	}
	if inst.Status != instance.StatusConnected {
		_ = c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error":   "instance_not_connected",
			"message": "Instance is not connected to WhatsApp.",
			"status":  400,
		})
		return nil, nil, false
	}
	client, err := h.manager.GetClient(inst.ID)
	if err != nil || client == nil {
		msg := "client not initialized"
		if err != nil {
			msg = err.Error()
		}
		_ = internalErrorResponse(c, msg)
		return nil, nil, false
	}
	return inst, client, true
}

// GET /api/v1/label
func (h *LabelHandler) List(c *fiber.Ctx) error {
	_, client, ok := h.getConnectedClient(c)
	if !ok {
		return nil
	}
	return c.JSON(client.ListLabels())
}

// POST /api/v1/label/sync — força o full-sync do app-state e devolve as etiquetas.
func (h *LabelHandler) Sync(c *fiber.Ctx) error {
	_, client, ok := h.getConnectedClient(c)
	if !ok {
		return nil
	}
	client.SyncLabels()
	return c.JSON(fiber.Map{"labels": client.ListLabels()})
}

// POST /api/v1/label
func (h *LabelHandler) Upsert(c *fiber.Ctx) error {
	_, client, ok := h.getConnectedClient(c)
	if !ok {
		return nil
	}
	var req struct {
		ID    string `json:"id"`
		Name  string `json:"name"`
		Color int    `json:"color"`
	}
	if err := c.BodyParser(&req); err != nil {
		return invalidRequestResponse(c, "Invalid request body.")
	}
	if req.Name == "" {
		return invalidRequestResponse(c, "name is required.")
	}
	label, err := client.UpsertLabel(req.ID, req.Name, req.Color)
	if err != nil {
		return internalErrorResponse(c, err.Error())
	}
	return c.JSON(label)
}

// DELETE /api/v1/label/:id
func (h *LabelHandler) Delete(c *fiber.Ctx) error {
	_, client, ok := h.getConnectedClient(c)
	if !ok {
		return nil
	}
	id := decodeParam(c, "id")
	if id == "" {
		return invalidRequestResponse(c, "id is required.")
	}
	if err := client.DeleteLabel(id); err != nil {
		return internalErrorResponse(c, err.Error())
	}
	return c.JSON(fiber.Map{"status": "deleted"})
}

// PUT /api/v1/label/:id/chat
func (h *LabelHandler) SetChat(c *fiber.Ctx) error {
	_, client, ok := h.getConnectedClient(c)
	if !ok {
		return nil
	}
	id := decodeParam(c, "id")
	var req struct {
		ChatJID string `json:"chat_jid"`
		On      bool   `json:"on"`
	}
	if err := c.BodyParser(&req); err != nil {
		return invalidRequestResponse(c, "Invalid request body.")
	}
	if req.ChatJID == "" {
		return invalidRequestResponse(c, "chat_jid is required.")
	}
	if err := client.SetChatLabel(req.ChatJID, id, req.On); err != nil {
		return internalErrorResponse(c, err.Error())
	}
	return c.JSON(fiber.Map{"status": "ok"})
}

// GET /api/v1/label/:id/chats
func (h *LabelHandler) Chats(c *fiber.Ctx) error {
	_, client, ok := h.getConnectedClient(c)
	if !ok {
		return nil
	}
	id := decodeParam(c, "id")
	return c.JSON(fiber.Map{"chats": client.GetLabelChats(id)})
}

// GET /api/v1/chat-labels/:jid
func (h *LabelHandler) ChatLabels(c *fiber.Ctx) error {
	_, client, ok := h.getConnectedClient(c)
	if !ok {
		return nil
	}
	jid := decodeParam(c, "jid")
	if jid == "" {
		return invalidRequestResponse(c, "jid is required.")
	}
	return c.JSON(client.GetChatLabels(jid))
}
