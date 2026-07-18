package handler

import (
	"wamux_go/internal/instance"
	"wamux_go/internal/middleware"
	"wamux_go/internal/whatsapp"

	"github.com/gofiber/fiber/v2"
)

type NewsletterHandler struct {
	manager *instance.Manager
}

func NewNewsletterHandler(manager *instance.Manager) *NewsletterHandler {
	return &NewsletterHandler{manager: manager}
}

// getConnectedClient resolves the instance + live client for the request, writing
// the appropriate error response itself. The boolean return is the ONLY signal
// callers should use to decide whether to proceed — see the identical comment on
// GroupHandler.getConnectedClient for why the previous `error` return was unsafe.
func (h *NewsletterHandler) getConnectedClient(c *fiber.Ctx) (*instance.Instance, *whatsapp.Client, bool) {
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

// GET /api/v1/newsletter
func (h *NewsletterHandler) List(c *fiber.Ctx) error {
	_, client, ok := h.getConnectedClient(c)
	if !ok {
		return nil
	}

	newsletters, err := client.ListNewsletters()
	if err != nil {
		return internalErrorResponse(c, err.Error())
	}

	return c.JSON(fiber.Map{
		"newsletters": newsletters,
		"total":       len(newsletters),
	})
}

// POST /api/v1/newsletter
func (h *NewsletterHandler) Create(c *fiber.Ctx) error {
	_, client, ok := h.getConnectedClient(c)
	if !ok {
		return nil
	}

	var req struct {
		Name        string `json:"name"`
		Description string `json:"description"`
	}
	if err := c.BodyParser(&req); err != nil {
		return invalidRequestResponse(c, "Invalid request body.")
	}
	if req.Name == "" {
		return invalidRequestResponse(c, "name is required.")
	}

	info, err := client.CreateNewsletter(req.Name, req.Description)
	if err != nil {
		return internalErrorResponse(c, err.Error())
	}

	return c.Status(fiber.StatusCreated).JSON(info)
}

// GET /api/v1/newsletter/:jid
func (h *NewsletterHandler) Metadata(c *fiber.Ctx) error {
	_, client, ok := h.getConnectedClient(c)
	if !ok {
		return nil
	}

	jid := decodeParam(c, "jid")
	if jid == "" {
		return invalidRequestResponse(c, "JID is required.")
	}

	info, err := client.NewsletterMetadata(jid)
	if err != nil {
		return internalErrorResponse(c, err.Error())
	}

	return c.JSON(info)
}

// POST /api/v1/newsletter/:jid/follow
func (h *NewsletterHandler) Follow(c *fiber.Ctx) error {
	_, client, ok := h.getConnectedClient(c)
	if !ok {
		return nil
	}

	jid := decodeParam(c, "jid")
	if jid == "" {
		return invalidRequestResponse(c, "JID is required.")
	}

	if err := client.FollowNewsletter(jid); err != nil {
		return internalErrorResponse(c, err.Error())
	}

	return c.JSON(fiber.Map{"status": "followed"})
}

// DELETE /api/v1/newsletter/:jid/follow
func (h *NewsletterHandler) Unfollow(c *fiber.Ctx) error {
	_, client, ok := h.getConnectedClient(c)
	if !ok {
		return nil
	}

	jid := decodeParam(c, "jid")
	if jid == "" {
		return invalidRequestResponse(c, "JID is required.")
	}

	if err := client.UnfollowNewsletter(jid); err != nil {
		return internalErrorResponse(c, err.Error())
	}

	return c.JSON(fiber.Map{"status": "unfollowed"})
}
