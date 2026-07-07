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

func (h *LabelHandler) getConnectedClient(c *fiber.Ctx) (*instance.Instance, *whatsapp.Client, error) {
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
	return inst, client, nil
}

// GET /api/v1/label
func (h *LabelHandler) List(c *fiber.Ctx) error {
	_, client, err := h.getConnectedClient(c)
	if err != nil {
		return err
	}
	return c.JSON(client.ListLabels())
}

// POST /api/v1/label/sync — força o full-sync do app-state e devolve as etiquetas.
func (h *LabelHandler) Sync(c *fiber.Ctx) error {
	_, client, err := h.getConnectedClient(c)
	if err != nil {
		return err
	}
	client.SyncLabels()
	return c.JSON(fiber.Map{"labels": client.ListLabels()})
}

// POST /api/v1/label
func (h *LabelHandler) Upsert(c *fiber.Ctx) error {
	_, client, err := h.getConnectedClient(c)
	if err != nil {
		return err
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
	_, client, err := h.getConnectedClient(c)
	if err != nil {
		return err
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
	_, client, err := h.getConnectedClient(c)
	if err != nil {
		return err
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
	_, client, err := h.getConnectedClient(c)
	if err != nil {
		return err
	}
	id := decodeParam(c, "id")
	return c.JSON(fiber.Map{"chats": client.GetLabelChats(id)})
}

// GET /api/v1/chat-labels/:jid
func (h *LabelHandler) ChatLabels(c *fiber.Ctx) error {
	_, client, err := h.getConnectedClient(c)
	if err != nil {
		return err
	}
	jid := decodeParam(c, "jid")
	if jid == "" {
		return invalidRequestResponse(c, "jid is required.")
	}
	return c.JSON(client.GetChatLabels(jid))
}
