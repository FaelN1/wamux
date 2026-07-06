package handler

import (
	"wamux_go/internal/instance"
	"wamux_go/internal/middleware"
	"wamux_go/internal/whatsapp"

	"github.com/gofiber/fiber/v2"
)

type ProfileHandler struct {
	manager *instance.Manager
}

func NewProfileHandler(manager *instance.Manager) *ProfileHandler {
	return &ProfileHandler{manager: manager}
}

// GET /api/v1/profile
func (h *ProfileHandler) Get(c *fiber.Ctx) error {
	inst := middleware.GetInstance(c)
	if inst == nil {
		return unauthorizedResponse(c)
	}
	if inst.Status != instance.StatusConnected {
		return invalidRequestResponse(c, "Instance is not connected.")
	}

	client, err := h.manager.GetClient(inst.ID)
	if err != nil {
		return internalErrorResponse(c, err.Error())
	}

	profile, err := client.GetProfile()
	if err != nil {
		return internalErrorResponse(c, err.Error())
	}

	return c.JSON(profile)
}

// PUT /api/v1/profile
func (h *ProfileHandler) Update(c *fiber.Ctx) error {
	inst := middleware.GetInstance(c)
	if inst == nil {
		return unauthorizedResponse(c)
	}
	if inst.Status != instance.StatusConnected {
		return invalidRequestResponse(c, "Instance is not connected.")
	}

	var req whatsapp.UpdateProfileRequest
	if err := c.BodyParser(&req); err != nil {
		return invalidRequestResponse(c, "Invalid request body.")
	}

	client, err := h.manager.GetClient(inst.ID)
	if err != nil {
		return internalErrorResponse(c, err.Error())
	}

	if err := client.UpdateProfile(req); err != nil {
		return internalErrorResponse(c, err.Error())
	}

	return c.JSON(fiber.Map{"status": "updated"})
}
