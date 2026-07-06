package handler

import (
	"wamux_go/internal/instance"
	"wamux_go/internal/middleware"
	"wamux_go/internal/whatsapp"

	"github.com/gofiber/fiber/v2"
)

type GroupHandler struct {
	manager *instance.Manager
}

func NewGroupHandler(manager *instance.Manager) *GroupHandler {
	return &GroupHandler{manager: manager}
}

func (h *GroupHandler) getConnectedClient(c *fiber.Ctx) (*instance.Instance, *whatsapp.Client, error) {
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

// GET /api/v1/community - List communities (cached)
func (h *GroupHandler) ListCommunities(c *fiber.Ctx) error {
	_, client, err := h.getConnectedClient(c)
	if err != nil {
		return err
	}

	onlyAdmin := c.Query("only_admin", "false") == "true"
	includeMembers := c.Query("include_members", "false") == "true"

	// Try cache first
	if cached, ok := client.GetCachedCommunities(onlyAdmin, includeMembers); ok {
		return c.JSON(fiber.Map{
			"communities": cached,
			"total":       len(cached),
			"source":      "cache",
		})
	}

	// Cache miss - check if sync is in progress
	status := client.GetCommunitySyncStatus()
	if status == whatsapp.CommunitySyncStatusSyncing {
		return c.Status(fiber.StatusAccepted).JSON(fiber.Map{
			"status":  "syncing",
			"message": "Community data is being synced. You will receive a COMMUNITY_SYNC_DONE event via WebSocket when ready.",
		})
	}

	// No cache and not syncing - trigger sync and fetch synchronously
	communities, err := client.ListCommunities(onlyAdmin, includeMembers)
	if err != nil {
		return internalErrorResponse(c, err.Error())
	}

	return c.JSON(fiber.Map{
		"communities": communities,
		"total":       len(communities),
		"source":      "live",
	})
}

// POST /api/v1/community/sync - Force community sync
func (h *GroupHandler) SyncCommunities(c *fiber.Ctx) error {
	_, client, err := h.getConnectedClient(c)
	if err != nil {
		return err
	}

	client.SyncCommunities()

	return c.JSON(fiber.Map{
		"status":  "syncing",
		"message": "Sync started. A COMMUNITY_SYNC_DONE event will be sent via WebSocket when complete.",
	})
}

// POST /api/v1/community
func (h *GroupHandler) CreateCommunity(c *fiber.Ctx) error {
	_, client, err := h.getConnectedClient(c)
	if err != nil {
		return err
	}

	var req whatsapp.CommunityRequest
	if err := c.BodyParser(&req); err != nil {
		return invalidRequestResponse(c, "Invalid request body.")
	}

	if req.Name == "" {
		return invalidRequestResponse(c, "name is required.")
	}

	info, err := client.CreateCommunity(req)
	if err != nil {
		return internalErrorResponse(c, err.Error())
	}

	client.InvalidateCommunityCache()
	return c.Status(fiber.StatusCreated).JSON(info)
}

// GET /api/v1/community/:jid/link
func (h *GroupHandler) GetInviteLink(c *fiber.Ctx) error {
	_, client, err := h.getConnectedClient(c)
	if err != nil {
		return err
	}

	jid := decodeParam(c, "jid")
	if jid == "" {
		return invalidRequestResponse(c, "JID is required.")
	}

	links, err := client.GetInviteLink(jid)
	if err != nil {
		return internalErrorResponse(c, err.Error())
	}

	return c.JSON(fiber.Map{
		"links": links,
		"total": len(links),
	})
}

// DELETE /api/v1/community/:jid
func (h *GroupHandler) DeleteCommunity(c *fiber.Ctx) error {
	_, client, err := h.getConnectedClient(c)
	if err != nil {
		return err
	}

	jid := decodeParam(c, "jid")
	if jid == "" {
		return invalidRequestResponse(c, "JID is required.")
	}

	if err := client.DeleteCommunityFull(jid); err != nil {
		return internalErrorResponse(c, err.Error())
	}

	client.InvalidateCommunityCache()
	return c.JSON(fiber.Map{
		"status": "deleted",
	})
}

// POST /api/v1/community/:jid/admins/promote
func (h *GroupHandler) PromoteAdmins(c *fiber.Ctx) error {
	_, client, err := h.getConnectedClient(c)
	if err != nil {
		return err
	}

	jid := decodeParam(c, "jid")
	var req struct {
		Participants []string `json:"participants"`
	}
	if err := c.BodyParser(&req); err != nil {
		return invalidRequestResponse(c, "Invalid request body.")
	}

	if len(req.Participants) == 0 {
		return invalidRequestResponse(c, "participants are required.")
	}

	if err := client.PromoteAdmins(jid, req.Participants); err != nil {
		return internalErrorResponse(c, err.Error())
	}

	return c.JSON(fiber.Map{
		"status": "promoted",
	})
}

// POST /api/v1/community/:jid/admins/demote
func (h *GroupHandler) DemoteAdmins(c *fiber.Ctx) error {
	_, client, err := h.getConnectedClient(c)
	if err != nil {
		return err
	}

	jid := decodeParam(c, "jid")
	var req struct {
		Participants []string `json:"participants"`
	}
	if err := c.BodyParser(&req); err != nil {
		return invalidRequestResponse(c, "Invalid request body.")
	}

	if len(req.Participants) == 0 {
		return invalidRequestResponse(c, "participants are required.")
	}

	if err := client.DemoteAdmins(jid, req.Participants); err != nil {
		return internalErrorResponse(c, err.Error())
	}

	return c.JSON(fiber.Map{
		"status": "demoted",
	})
}

// PUT /api/v1/community/:jid
func (h *GroupHandler) UpdateGroupInfo(c *fiber.Ctx) error {
	_, client, err := h.getConnectedClient(c)
	if err != nil {
		return err
	}

	jid := decodeParam(c, "jid")
	var req whatsapp.UpdateCommunityRequest
	if err := c.BodyParser(&req); err != nil {
		return invalidRequestResponse(c, "Invalid request body.")
	}

	if err := client.UpdateCommunity(jid, req); err != nil {
		return internalErrorResponse(c, err.Error())
	}

	return c.JSON(fiber.Map{
		"status": "updated",
	})
}

// GET /api/v1/community/:jid/members
func (h *GroupHandler) GetMembers(c *fiber.Ctx) error {
	_, client, err := h.getConnectedClient(c)
	if err != nil {
		return err
	}

	jid := decodeParam(c, "jid")
	if jid == "" {
		return invalidRequestResponse(c, "JID is required.")
	}

	members, err := client.GetMembers(jid)
	if err != nil {
		return internalErrorResponse(c, err.Error())
	}

	return c.JSON(fiber.Map{
		"members": members,
		"total":   len(members),
	})
}
