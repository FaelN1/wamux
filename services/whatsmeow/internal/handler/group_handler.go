package handler

import (
	"strings"

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

// getConnectedClient resolves the instance + live client for the request, writing
// the appropriate error response itself. The boolean return is the ONLY signal
// callers should use to decide whether to proceed — c.JSON()/c.Status().JSON()
// return nil on a successful write, so using that as an "error" sentinel here
// previously let callers fall through with a nil client after an early-return
// branch had already written a 400/401/500 response (see incident: GET
// /community on a disconnected instance panicked with a nil pointer dereference
// inside whatsapp.Client because the caller's `if err != nil` check never fired).
func (h *GroupHandler) getConnectedClient(c *fiber.Ctx) (*instance.Instance, *whatsapp.Client, bool) {
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

// GET /api/v1/community - List communities (cached)
func (h *GroupHandler) ListCommunities(c *fiber.Ctx) error {
	_, client, ok := h.getConnectedClient(c)
	if !ok {
		return nil
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
	_, client, ok := h.getConnectedClient(c)
	if !ok {
		return nil
	}

	client.SyncCommunities()

	return c.JSON(fiber.Map{
		"status":  "syncing",
		"message": "Sync started. A COMMUNITY_SYNC_DONE event will be sent via WebSocket when complete.",
	})
}

// POST /api/v1/community
func (h *GroupHandler) CreateCommunity(c *fiber.Ctx) error {
	_, client, ok := h.getConnectedClient(c)
	if !ok {
		return nil
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
	_, client, ok := h.getConnectedClient(c)
	if !ok {
		return nil
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
	_, client, ok := h.getConnectedClient(c)
	if !ok {
		return nil
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
	_, client, ok := h.getConnectedClient(c)
	if !ok {
		return nil
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
	_, client, ok := h.getConnectedClient(c)
	if !ok {
		return nil
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
	_, client, ok := h.getConnectedClient(c)
	if !ok {
		return nil
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
	_, client, ok := h.getConnectedClient(c)
	if !ok {
		return nil
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

// ── Regular groups ──────────────────────────────────────────────

// GET /api/v1/group
func (h *GroupHandler) ListGroups(c *fiber.Ctx) error {
	_, client, ok := h.getConnectedClient(c)
	if !ok {
		return nil
	}
	groups, err := client.ListGroups()
	if err != nil {
		return internalErrorResponse(c, err.Error())
	}
	return c.JSON(groups)
}

// GET /api/v1/group/:jid
func (h *GroupHandler) GetGroupInfo(c *fiber.Ctx) error {
	_, client, ok := h.getConnectedClient(c)
	if !ok {
		return nil
	}
	jid := decodeParam(c, "jid")
	if jid == "" {
		return invalidRequestResponse(c, "JID is required.")
	}
	info, err := client.GroupInfo(jid)
	if err != nil {
		return internalErrorResponse(c, err.Error())
	}
	return c.JSON(info)
}

// POST /api/v1/group
func (h *GroupHandler) CreateGroup(c *fiber.Ctx) error {
	_, client, ok := h.getConnectedClient(c)
	if !ok {
		return nil
	}
	var req struct {
		Subject      string   `json:"subject"`
		Participants []string `json:"participants"`
		Description  string   `json:"description"`
	}
	if err := c.BodyParser(&req); err != nil {
		return invalidRequestResponse(c, "Invalid request body.")
	}
	if req.Subject == "" {
		return invalidRequestResponse(c, "subject is required.")
	}
	info, err := client.CreateGroup(req.Subject, req.Participants)
	if err != nil {
		return internalErrorResponse(c, err.Error())
	}
	if req.Description != "" {
		if e := client.SetGroupDescription(info.JID, req.Description); e == nil {
			if updated, e2 := client.GroupInfo(info.JID); e2 == nil {
				info = updated
			}
		}
	}
	return c.Status(fiber.StatusCreated).JSON(info)
}

// POST /api/v1/group/:jid/participants
func (h *GroupHandler) UpdateParticipants(c *fiber.Ctx) error {
	_, client, ok := h.getConnectedClient(c)
	if !ok {
		return nil
	}
	jid := decodeParam(c, "jid")
	var req struct {
		Participants []string `json:"participants"`
		Action       string   `json:"action"`
	}
	if err := c.BodyParser(&req); err != nil {
		return invalidRequestResponse(c, "Invalid request body.")
	}
	if len(req.Participants) == 0 {
		return invalidRequestResponse(c, "participants are required.")
	}
	results, err := client.UpdateGroupParticipants(jid, req.Participants, req.Action)
	if err != nil {
		return internalErrorResponse(c, err.Error())
	}
	return c.JSON(results)
}

// PUT /api/v1/group/:jid/subject
func (h *GroupHandler) SetGroupSubject(c *fiber.Ctx) error {
	_, client, ok := h.getConnectedClient(c)
	if !ok {
		return nil
	}
	jid := decodeParam(c, "jid")
	var req struct {
		Subject string `json:"subject"`
	}
	if err := c.BodyParser(&req); err != nil {
		return invalidRequestResponse(c, "Invalid request body.")
	}
	if err := client.SetGroupSubject(jid, req.Subject); err != nil {
		return internalErrorResponse(c, err.Error())
	}
	return c.JSON(fiber.Map{"status": "updated"})
}

// PUT /api/v1/group/:jid/description
func (h *GroupHandler) SetGroupDescription(c *fiber.Ctx) error {
	_, client, ok := h.getConnectedClient(c)
	if !ok {
		return nil
	}
	jid := decodeParam(c, "jid")
	var req struct {
		Description string `json:"description"`
	}
	if err := c.BodyParser(&req); err != nil {
		return invalidRequestResponse(c, "Invalid request body.")
	}
	if err := client.SetGroupDescription(jid, req.Description); err != nil {
		return internalErrorResponse(c, err.Error())
	}
	return c.JSON(fiber.Map{"status": "updated"})
}

// PUT /api/v1/group/:jid/setting
func (h *GroupHandler) SetGroupSetting(c *fiber.Ctx) error {
	_, client, ok := h.getConnectedClient(c)
	if !ok {
		return nil
	}
	jid := decodeParam(c, "jid")
	var req struct {
		Setting string `json:"setting"`
	}
	if err := c.BodyParser(&req); err != nil {
		return invalidRequestResponse(c, "Invalid request body.")
	}
	if err := client.SetGroupSetting(jid, req.Setting); err != nil {
		return internalErrorResponse(c, err.Error())
	}
	return c.JSON(fiber.Map{"status": "updated"})
}

// GET /api/v1/group/:jid/invite
func (h *GroupHandler) GetGroupInvite(c *fiber.Ctx) error {
	_, client, ok := h.getConnectedClient(c)
	if !ok {
		return nil
	}
	jid := decodeParam(c, "jid")
	link, err := client.GroupInviteLink(jid, false)
	if err != nil {
		return internalErrorResponse(c, err.Error())
	}
	return c.JSON(inviteResponse(link))
}

// DELETE /api/v1/group/:jid/invite
func (h *GroupHandler) RevokeGroupInvite(c *fiber.Ctx) error {
	_, client, ok := h.getConnectedClient(c)
	if !ok {
		return nil
	}
	jid := decodeParam(c, "jid")
	link, err := client.GroupInviteLink(jid, true)
	if err != nil {
		return internalErrorResponse(c, err.Error())
	}
	return c.JSON(inviteResponse(link))
}

// POST /api/v1/group/join
func (h *GroupHandler) JoinGroup(c *fiber.Ctx) error {
	_, client, ok := h.getConnectedClient(c)
	if !ok {
		return nil
	}
	var req struct {
		Code string `json:"code"`
	}
	if err := c.BodyParser(&req); err != nil {
		return invalidRequestResponse(c, "Invalid request body.")
	}
	code := strings.TrimPrefix(strings.TrimSpace(req.Code), "https://chat.whatsapp.com/")
	if code == "" {
		return invalidRequestResponse(c, "code is required.")
	}
	jid, err := client.JoinGroup(code)
	if err != nil {
		return internalErrorResponse(c, err.Error())
	}
	return c.JSON(fiber.Map{"jid": jid})
}

// POST /api/v1/group/:jid/leave
func (h *GroupHandler) LeaveGroup(c *fiber.Ctx) error {
	_, client, ok := h.getConnectedClient(c)
	if !ok {
		return nil
	}
	jid := decodeParam(c, "jid")
	if err := client.LeaveGroup(jid); err != nil {
		return internalErrorResponse(c, err.Error())
	}
	return c.JSON(fiber.Map{"status": "left"})
}

func inviteResponse(link string) fiber.Map {
	code := strings.TrimPrefix(link, "https://chat.whatsapp.com/")
	return fiber.Map{"code": code, "link": link}
}
