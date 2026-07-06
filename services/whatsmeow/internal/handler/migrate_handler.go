package handler

import (
	"fmt"
	"runtime/debug"

	"wamux_go/internal/instance"
	"wamux_go/internal/middleware"
	"wamux_go/internal/whatsapp"

	"github.com/gofiber/fiber/v2"
	"github.com/rs/zerolog/log"
)

// MigrateHandler expõe export/import das credenciais do device (Multi-Device),
// usado pelo gateway (WAMux) para trocar de engine sem reparear.
type MigrateHandler struct {
	manager *instance.Manager
}

func NewMigrateHandler(manager *instance.Manager) *MigrateHandler {
	return &MigrateHandler{manager: manager}
}

// GET /api/v1/instance/export — exporta as credenciais canônicas.
func (h *MigrateHandler) Export(c *fiber.Ctx) error {
	inst := middleware.GetInstance(c)
	if inst == nil {
		return unauthorizedResponse(c)
	}
	creds, err := h.manager.ExportDevice(c.Context(), inst.ID)
	if err != nil {
		return internalErrorResponse(c, err.Error())
	}
	return c.JSON(creds)
}

// POST /api/v1/instance/import — importa credenciais canônicas (device linkado).
func (h *MigrateHandler) Import(c *fiber.Ctx) (err error) {
	// Converte um eventual panic (ex.: campo inesperado no store) num erro JSON
	// visível com stack, em vez de um 500 mudo (fasthttp engole o panic).
	defer func() {
		if r := recover(); r != nil {
			log.Error().Interface("panic", r).Bytes("stack", debug.Stack()).
				Msg("panic no import de credenciais")
			err = internalErrorResponse(c, fmt.Sprintf("panic no import: %v", r))
		}
	}()
	inst := middleware.GetInstance(c)
	if inst == nil {
		return unauthorizedResponse(c)
	}
	var creds whatsapp.PortableCreds
	if err := c.BodyParser(&creds); err != nil {
		return invalidRequestResponse(c, "corpo inválido")
	}
	if err := h.manager.ImportDevice(c.Context(), inst.ID, &creds); err != nil {
		log.Error().Err(err).Str("instance_id", inst.ID).Msg("falha ao importar credenciais")
		return internalErrorResponse(c, err.Error())
	}
	return c.JSON(fiber.Map{"status": "imported"})
}

// POST /api/v1/instance/:id/resume — conecta uma sessão já registrada (device
// linkado) sem QR nem logout. Usado após importar credenciais (migração de
// engine) para subir o socket. Master key (roteia por id interno).
func (h *MigrateHandler) Resume(c *fiber.Ctx) error {
	id := c.Params("id")
	if id == "" {
		return invalidRequestResponse(c, "id obrigatório")
	}
	if err := h.manager.ConnectExisting(c.Context(), id); err != nil {
		log.Error().Err(err).Str("instance_id", id).Msg("falha ao conectar sessão existente")
		return internalErrorResponse(c, err.Error())
	}
	return c.JSON(fiber.Map{"status": "connecting"})
}
