package handler

import (
	"bufio"
	"fmt"

	"wamux_go/internal/instance"
	"wamux_go/internal/middleware"

	"github.com/gofiber/fiber/v2"
)

type InstanceHandler struct {
	manager *instance.Manager
	repo    instance.Repository
}

func NewInstanceHandler(manager *instance.Manager, repo instance.Repository) *InstanceHandler {
	return &InstanceHandler{manager: manager, repo: repo}
}

// POST /api/v1/instance - Create instance (no auth required)
func (h *InstanceHandler) Create(c *fiber.Ctx) error {
	var req instance.CreateRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error":   "invalid_request",
			"message": "Invalid request body.",
			"status":  400,
		})
	}

	if req.CompanyName == "" || req.SideName == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error":   "invalid_request",
			"message": "company_name and side_name are required.",
			"status":  400,
		})
	}

	inst, pairingCode, err := h.manager.CreateInstance(c.Context(), req)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error":   "internal_error",
			"message": err.Error(),
			"status":  500,
		})
	}

	response := fiber.Map{
		"id":           inst.ID,
		"company_name": inst.CompanyName,
		"side_name":    inst.SideName,
		"api_key":      inst.APIKey,
		"webhook_url":  inst.WebhookURL,
		"status":       inst.Status,
		"phone_number": inst.PhoneNumber,
		"created_at":   inst.CreatedAt,
	}

	if pairingCode != "" {
		response["pairing_code"] = pairingCode
	}

	return c.Status(fiber.StatusCreated).JSON(response)
}

// GET /api/v1/instance - Get instance by API Key
func (h *InstanceHandler) Get(c *fiber.Ctx) error {
	inst := middleware.GetInstance(c)
	if inst == nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"error":   "unauthorized",
			"message": "Instance not found.",
			"status":  401,
		})
	}

	inst.APIKey = "" // don't expose API key

	return c.JSON(inst)
}

// PUT /api/v1/instance - Update instance
func (h *InstanceHandler) Update(c *fiber.Ctx) error {
	inst := middleware.GetInstance(c)
	if inst == nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"error":   "unauthorized",
			"message": "Instance not found.",
			"status":  401,
		})
	}

	var req instance.UpdateRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error":   "invalid_request",
			"message": "Invalid request body.",
			"status":  400,
		})
	}

	if req.CompanyName != "" {
		inst.CompanyName = req.CompanyName
	}
	if req.SideName != "" {
		inst.SideName = req.SideName
	}
	if req.WebhookURL != "" {
		inst.WebhookURL = req.WebhookURL
	}
	if req.WebhookEvents != nil {
		inst.WebhookEvents = instance.WebhookEvents(req.WebhookEvents)
	}
	if req.ProxyURL != "" {
		inst.ProxyURL = req.ProxyURL
	}

	if err := h.repo.Update(c.Context(), inst); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error":   "internal_error",
			"message": err.Error(),
			"status":  500,
		})
	}

	inst.APIKey = ""
	return c.JSON(inst)
}

// GET /api/v1/instance/status - Connection status
func (h *InstanceHandler) Status(c *fiber.Ctx) error {
	inst := middleware.GetInstance(c)
	if inst == nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"error":   "unauthorized",
			"message": "Instance not found.",
			"status":  401,
		})
	}

	return c.JSON(fiber.Map{
		"instance_id": inst.ID,
		"status":      inst.Status,
	})
}

// GET /api/v1/instance/qrcode - Generate QR or Pairing Code (Instance API Key)
func (h *InstanceHandler) QRCode(c *fiber.Ctx) error {
	inst := middleware.GetInstance(c)
	if inst == nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"error":   "unauthorized",
			"message": "Instance not found.",
			"status":  401,
		})
	}

	phone := c.Query("phone")
	if phone == "" {
		phone = inst.PhoneNumber
	}

	result, err := h.manager.ConnectForPairing(c.Context(), inst.ID, phone)
	if err != nil {
		return internalErrorResponse(c, err.Error())
	}

	// Return first QR code + pairing code
	response := fiber.Map{}
	if result.PairingCode != "" {
		response["pairing_code"] = result.PairingCode
	}

	for evt := range result.QRChannel {
		if evt.Event == "code" {
			response["qr_code"] = evt.Code
			return c.JSON(response)
		}
	}

	return internalErrorResponse(c, "Failed to generate QR code.")
}

// GET /api/v1/instance/all - List all instances (Master Key)
func (h *InstanceHandler) ListAll(c *fiber.Ctx) error {
	instances, err := h.repo.GetAll(c.Context())
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error":   "internal_error",
			"message": err.Error(),
			"status":  500,
		})
	}

	return c.JSON(fiber.Map{
		"instances": instances,
		"total":     len(instances),
	})
}

// DELETE /api/v1/instance/:id - Delete instance (Master Key)
func (h *InstanceHandler) DeleteByID(c *fiber.Ctx) error {
	id := c.Params("id")
	if id == "" {
		return invalidRequestResponse(c, "Instance ID is required.")
	}

	if err := h.manager.DisconnectInstance(c.Context(), id); err != nil {
		// ignore disconnect errors, instance may already be disconnected
	}

	if err := h.repo.Delete(c.Context(), id); err != nil {
		return internalErrorResponse(c, err.Error())
	}

	return c.JSON(fiber.Map{"status": "deleted"})
}

// POST /api/v1/instance/:id/disconnect - Disconnect instance (Master Key)
func (h *InstanceHandler) DisconnectByID(c *fiber.Ctx) error {
	id := c.Params("id")
	if id == "" {
		return invalidRequestResponse(c, "Instance ID is required.")
	}

	if err := h.manager.DisconnectInstance(c.Context(), id); err != nil {
		return internalErrorResponse(c, err.Error())
	}

	return c.JSON(fiber.Map{"status": "disconnected"})
}

// GET /api/v1/instance/:id/connect - SSE stream: sends QR codes + pairing code, waits for connection
func (h *InstanceHandler) ConnectByID(c *fiber.Ctx) error {
	id := c.Params("id")
	if id == "" {
		return invalidRequestResponse(c, "Instance ID is required.")
	}

	phone := c.Query("phone")

	// If no phone in query, try to get from the instance record
	if phone == "" {
		inst, err := h.repo.GetByID(c.Context(), id)
		if err != nil {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
				"error":   "instance_not_found",
				"message": "Instance not found.",
				"status":  404,
			})
		}
		phone = inst.PhoneNumber
	}

	result, err := h.manager.ConnectForPairing(c.Context(), id, phone)
	if err != nil {
		return internalErrorResponse(c, err.Error())
	}

	c.Set("Content-Type", "text/event-stream")
	c.Set("Cache-Control", "no-cache")
	c.Set("Connection", "keep-alive")

	c.Context().SetBodyStreamWriter(func(w *bufio.Writer) {
		// Send pairing code first if available
		if result.PairingCode != "" {
			fmt.Fprintf(w, "event: pairing_code\ndata: %s\n\n", result.PairingCode)
			w.Flush()
		}

		// Stream QR codes
		for evt := range result.QRChannel {
			switch evt.Event {
			case "code":
				fmt.Fprintf(w, "event: qr\ndata: %s\n\n", evt.Code)
				w.Flush()
			case "success":
				fmt.Fprintf(w, "event: success\ndata: connected\n\n")
				w.Flush()
				return
			case "timeout":
				fmt.Fprintf(w, "event: timeout\ndata: timeout\n\n")
				w.Flush()
				return
			}
		}
	})

	return nil
}

// PUT /api/v1/instance/:id - Update instance by ID (Master Key)
func (h *InstanceHandler) UpdateByID(c *fiber.Ctx) error {
	id := c.Params("id")
	if id == "" {
		return invalidRequestResponse(c, "Instance ID is required.")
	}

	inst, err := h.repo.GetByID(c.Context(), id)
	if err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error":   "instance_not_found",
			"message": "Instance not found.",
			"status":  404,
		})
	}

	var req instance.UpdateRequest
	if err := c.BodyParser(&req); err != nil {
		return invalidRequestResponse(c, "Invalid request body.")
	}

	if req.CompanyName != "" {
		inst.CompanyName = req.CompanyName
	}
	if req.SideName != "" {
		inst.SideName = req.SideName
	}
	if req.WebhookURL != "" {
		inst.WebhookURL = req.WebhookURL
	}
	if req.WebhookEvents != nil {
		inst.WebhookEvents = instance.WebhookEvents(req.WebhookEvents)
	}
	if req.ProxyURL != "" {
		inst.ProxyURL = req.ProxyURL
	}

	if err := h.repo.Update(c.Context(), inst); err != nil {
		return internalErrorResponse(c, err.Error())
	}

	return c.JSON(inst)
}
