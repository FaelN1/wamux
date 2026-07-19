package whatsapp

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"sync"
	"time"

	"github.com/rs/zerolog"
	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/appstate"
	"go.mau.fi/whatsmeow/proto/waE2E"
	"go.mau.fi/whatsmeow/store/sqlstore"
	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/types/events"
	"google.golang.org/protobuf/proto"
)

const (
	CommunitySyncStatusIdle    = "idle"
	CommunitySyncStatusSyncing = "syncing"
	CommunitySyncStatusReady   = "ready"

	communityCacheTTL = 10 * time.Minute
)

type Client struct {
	WAClient   *whatsmeow.Client
	InstanceID string
	Store      *sqlstore.Container
	Logger     zerolog.Logger

	// Community cache
	communityMu     sync.RWMutex
	communityCache  []CommunityListItem
	communitySyncAt time.Time
	communitySyncStatus string
	OnCommunitySyncDone func() // called when background sync finishes

	// Label store (fed by app-state events)
	labelMu    sync.RWMutex
	labelStore map[string]LabelInfo       // labelID -> label
	labelAssoc map[string]map[string]bool // labelID -> set of chat JIDs
}

// InvalidateCommunityCache marks cache as stale so next read triggers a re-sync
func (c *Client) InvalidateCommunityCache() {
	c.communityMu.Lock()
	c.communityCache = nil
	c.communitySyncAt = time.Time{}
	c.communitySyncStatus = CommunitySyncStatusIdle
	c.communityMu.Unlock()
	c.Logger.Debug().Msg("community cache invalidated")
}

// CommunitySyncStatus returns the current sync state
func (c *Client) GetCommunitySyncStatus() string {
	c.communityMu.RLock()
	defer c.communityMu.RUnlock()
	if c.communitySyncStatus == "" {
		return CommunitySyncStatusIdle
	}
	return c.communitySyncStatus
}

// SyncCommunities runs GetJoinedGroups in background and populates the cache
func (c *Client) SyncCommunities() {
	c.communityMu.Lock()
	if c.communitySyncStatus == CommunitySyncStatusSyncing {
		c.communityMu.Unlock()
		return // already syncing
	}
	c.communitySyncStatus = CommunitySyncStatusSyncing
	c.communityMu.Unlock()

	c.Logger.Info().Msg("community sync started")

	go func() {
		communities, err := c.fetchCommunities()

		c.communityMu.Lock()
		if err != nil {
			c.Logger.Error().Err(err).Msg("community sync failed")
			c.communitySyncStatus = CommunitySyncStatusIdle
		} else {
			c.communityCache = communities
			c.communitySyncAt = time.Now()
			c.communitySyncStatus = CommunitySyncStatusReady
			c.Logger.Info().Int("count", len(communities)).Msg("community sync completed")
		}
		c.communityMu.Unlock()

		if err == nil && c.OnCommunitySyncDone != nil {
			c.OnCommunitySyncDone()
		}
	}()
}

// GetCachedCommunities returns cached data filtered by params, or nil if not ready.
// Defense-in-depth: a nil receiver here previously crashed the whole multi-tenant
// process (see manager.GetClient / handler getConnectedClient helpers, which are
// the actual fix for how a nil *Client could reach this method in the first
// place). Guard it directly too so a future caller mistake degrades to "no
// cache" instead of a panic.
func (c *Client) GetCachedCommunities(onlyAdmin bool, includeMembers bool) ([]CommunityListItem, bool) {
	if c == nil {
		return nil, false
	}
	c.communityMu.RLock()
	defer c.communityMu.RUnlock()

	if c.communityCache == nil || time.Since(c.communitySyncAt) > communityCacheTTL {
		return nil, false
	}

	// Filter from full cache
	var result []CommunityListItem
	for _, item := range c.communityCache {
		if onlyAdmin && !item.IsAdmin {
			continue
		}
		if includeMembers {
			result = append(result, item)
		} else {
			// Return without members
			copy := item
			copy.Members = nil
			result = append(result, copy)
		}
	}

	return result, true
}

type MediaRequest struct {
	To       string `json:"to"`
	Type     string `json:"type"` // image, video, audio, document
	URL      string `json:"url"`
	Caption  string `json:"caption"`
	FileName string `json:"file_name"`
	MimeType string `json:"mime_type"`
	ReplyTo  string `json:"reply_to"`
}

type PollRequest struct {
	To            string   `json:"to"`
	Question      string   `json:"question"`
	Options       []string `json:"options"`
	MaxSelections int      `json:"max_selections"`
}

type StatusRequest struct {
	Text            string `json:"text"`
	BackgroundColor string `json:"background_color"`
	Font            int    `json:"font"`
}

type CommunityRequest struct {
	Name        string   `json:"name"`
	Description string   `json:"description"`
	GroupNames  []string `json:"group_names"`
}

type CommunityInfo struct {
	CommunityJID string   `json:"community_jid"`
	GroupJIDs    []string `json:"group_jids"`
}

type UpdateGroupRequest struct {
	Name        *string `json:"name,omitempty"`
	Description *string `json:"description,omitempty"`
}

type Member struct {
	JID     string `json:"jid"`
	IsAdmin bool   `json:"is_admin"`
	IsOwner bool   `json:"is_owner,omitempty"`
}

func parseJID(jidStr string) (types.JID, error) {
	jid, err := types.ParseJID(jidStr)
	if err != nil {
		return types.JID{}, fmt.Errorf("invalid JID: %w", err)
	}
	return jid, nil
}

func (c *Client) SendText(to, text, replyTo string) (string, error) {
	ctx, cancel := waCtx()
	defer cancel()
	jid, err := parseJID(to)
	if err != nil {
		return "", err
	}

	msg := &waE2E.Message{
		ExtendedTextMessage: &waE2E.ExtendedTextMessage{
			Text: proto.String(text),
		},
	}

	if replyTo != "" {
		msg.ExtendedTextMessage.ContextInfo = &waE2E.ContextInfo{
			StanzaID: proto.String(replyTo),
		}
	}

	resp, err := c.WAClient.SendMessage(ctx, jid, msg)
	if err != nil {
		return "", fmt.Errorf("failed to send text: %w", err)
	}

	return resp.ID, nil
}

// SendMediaBytes sends media from raw bytes (for file upload)
func (c *Client) SendMediaBytes(to string, mediaData []byte, mediaType, mimeType, caption, fileName string) (string, error) {
	ctx, cancel := waCtx()
	defer cancel()

	jid, err := parseJID(to)
	if err != nil {
		return "", err
	}

	var msg *waE2E.Message

	switch mediaType {
	case "image":
		uploaded, err := c.WAClient.Upload(ctx, mediaData, whatsmeow.MediaImage)
		if err != nil {
			return "", fmt.Errorf("failed to upload image: %w", err)
		}
		msg = &waE2E.Message{
			ImageMessage: &waE2E.ImageMessage{
				URL:           proto.String(uploaded.URL),
				DirectPath:    proto.String(uploaded.DirectPath),
				MediaKey:      uploaded.MediaKey,
				Mimetype:      proto.String(mimeType),
				Caption:       proto.String(caption),
				FileEncSHA256: uploaded.FileEncSHA256,
				FileSHA256:    uploaded.FileSHA256,
				FileLength:    proto.Uint64(uint64(len(mediaData))),
			},
		}
	case "video":
		uploaded, err := c.WAClient.Upload(ctx, mediaData, whatsmeow.MediaVideo)
		if err != nil {
			return "", fmt.Errorf("failed to upload video: %w", err)
		}
		msg = &waE2E.Message{
			VideoMessage: &waE2E.VideoMessage{
				URL:           proto.String(uploaded.URL),
				DirectPath:    proto.String(uploaded.DirectPath),
				MediaKey:      uploaded.MediaKey,
				Mimetype:      proto.String(mimeType),
				Caption:       proto.String(caption),
				FileEncSHA256: uploaded.FileEncSHA256,
				FileSHA256:    uploaded.FileSHA256,
				FileLength:    proto.Uint64(uint64(len(mediaData))),
			},
		}
	case "audio":
		uploaded, err := c.WAClient.Upload(ctx, mediaData, whatsmeow.MediaAudio)
		if err != nil {
			return "", fmt.Errorf("failed to upload audio: %w", err)
		}
		msg = &waE2E.Message{
			AudioMessage: &waE2E.AudioMessage{
				URL:           proto.String(uploaded.URL),
				DirectPath:    proto.String(uploaded.DirectPath),
				MediaKey:      uploaded.MediaKey,
				Mimetype:      proto.String(mimeType),
				FileEncSHA256: uploaded.FileEncSHA256,
				FileSHA256:    uploaded.FileSHA256,
				FileLength:    proto.Uint64(uint64(len(mediaData))),
			},
		}
	default: // document
		uploaded, err := c.WAClient.Upload(ctx, mediaData, whatsmeow.MediaDocument)
		if err != nil {
			return "", fmt.Errorf("failed to upload document: %w", err)
		}
		msg = &waE2E.Message{
			DocumentMessage: &waE2E.DocumentMessage{
				URL:           proto.String(uploaded.URL),
				DirectPath:    proto.String(uploaded.DirectPath),
				MediaKey:      uploaded.MediaKey,
				Mimetype:      proto.String(mimeType),
				Caption:       proto.String(caption),
				FileName:      proto.String(fileName),
				FileEncSHA256: uploaded.FileEncSHA256,
				FileSHA256:    uploaded.FileSHA256,
				FileLength:    proto.Uint64(uint64(len(mediaData))),
			},
		}
	}

	resp, err := c.WAClient.SendMessage(ctx, jid, msg)
	if err != nil {
		return "", fmt.Errorf("failed to send media: %w", err)
	}
	return resp.ID, nil
}

// uploadForSend uploads media data to WhatsApp servers, choosing between the
// normal encrypted chat-media path (Upload) and the unencrypted newsletter
// media path (UploadNewsletter) based on isNewsletter. Newsletter content is
// public/broadcast, so it isn't encrypted and doesn't get a MediaKey /
// FileEncSHA256 — see the UploadNewsletter doc comment in the whatsmeow lib.
func (c *Client) uploadForSend(ctx context.Context, data []byte, mediaType whatsmeow.MediaType, isNewsletter bool) (whatsmeow.UploadResponse, error) {
	if isNewsletter {
		return c.WAClient.UploadNewsletter(ctx, data, mediaType)
	}
	return c.WAClient.Upload(ctx, data, mediaType)
}

func (c *Client) SendMedia(req MediaRequest) (string, error) {
	ctx, cancel := waCtx()
	defer cancel()
	jid, err := parseJID(req.To)
	if err != nil {
		return "", err
	}

	mediaData, err := downloadMedia(req.URL)
	if err != nil {
		return "", fmt.Errorf("failed to download media: %w", err)
	}

	isNewsletter := jid.Server == types.NewsletterServer

	var msg *waE2E.Message
	var mediaHandle string

	switch req.Type {
	case "image":
		uploaded, err := c.uploadForSend(ctx, mediaData, whatsmeow.MediaImage, isNewsletter)
		if err != nil {
			return "", fmt.Errorf("failed to upload image: %w", err)
		}
		mediaHandle = uploaded.Handle
		imageMsg := &waE2E.ImageMessage{
			URL:        proto.String(uploaded.URL),
			DirectPath: proto.String(uploaded.DirectPath),
			Mimetype:   proto.String(req.MimeType),
			Caption:    proto.String(req.Caption),
			FileSHA256: uploaded.FileSHA256,
			FileLength: proto.Uint64(uint64(len(mediaData))),
		}
		if !isNewsletter {
			imageMsg.MediaKey = uploaded.MediaKey
			imageMsg.FileEncSHA256 = uploaded.FileEncSHA256
		}
		msg = &waE2E.Message{ImageMessage: imageMsg}

	case "video":
		uploaded, err := c.uploadForSend(ctx, mediaData, whatsmeow.MediaVideo, isNewsletter)
		if err != nil {
			return "", fmt.Errorf("failed to upload video: %w", err)
		}
		mediaHandle = uploaded.Handle
		videoMsg := &waE2E.VideoMessage{
			URL:        proto.String(uploaded.URL),
			DirectPath: proto.String(uploaded.DirectPath),
			Mimetype:   proto.String(req.MimeType),
			Caption:    proto.String(req.Caption),
			FileSHA256: uploaded.FileSHA256,
			FileLength: proto.Uint64(uint64(len(mediaData))),
		}
		if !isNewsletter {
			videoMsg.MediaKey = uploaded.MediaKey
			videoMsg.FileEncSHA256 = uploaded.FileEncSHA256
		}
		msg = &waE2E.Message{VideoMessage: videoMsg}

	case "audio":
		uploaded, err := c.uploadForSend(ctx, mediaData, whatsmeow.MediaAudio, isNewsletter)
		if err != nil {
			return "", fmt.Errorf("failed to upload audio: %w", err)
		}
		mediaHandle = uploaded.Handle
		audioMsg := &waE2E.AudioMessage{
			URL:        proto.String(uploaded.URL),
			DirectPath: proto.String(uploaded.DirectPath),
			Mimetype:   proto.String(req.MimeType),
			FileSHA256: uploaded.FileSHA256,
			FileLength: proto.Uint64(uint64(len(mediaData))),
		}
		if !isNewsletter {
			audioMsg.MediaKey = uploaded.MediaKey
			audioMsg.FileEncSHA256 = uploaded.FileEncSHA256
		}
		msg = &waE2E.Message{AudioMessage: audioMsg}

	case "document":
		uploaded, err := c.uploadForSend(ctx, mediaData, whatsmeow.MediaDocument, isNewsletter)
		if err != nil {
			return "", fmt.Errorf("failed to upload document: %w", err)
		}
		mediaHandle = uploaded.Handle
		documentMsg := &waE2E.DocumentMessage{
			URL:        proto.String(uploaded.URL),
			DirectPath: proto.String(uploaded.DirectPath),
			Mimetype:   proto.String(req.MimeType),
			Caption:    proto.String(req.Caption),
			FileName:   proto.String(req.FileName),
			FileSHA256: uploaded.FileSHA256,
			FileLength: proto.Uint64(uint64(len(mediaData))),
		}
		if !isNewsletter {
			documentMsg.MediaKey = uploaded.MediaKey
			documentMsg.FileEncSHA256 = uploaded.FileEncSHA256
		}
		msg = &waE2E.Message{DocumentMessage: documentMsg}

	default:
		return "", fmt.Errorf("unsupported media type: %s", req.Type)
	}

	if req.ReplyTo != "" {
		setContextInfo(msg, req.ReplyTo)
	}

	var extra []whatsmeow.SendRequestExtra
	if isNewsletter {
		extra = append(extra, whatsmeow.SendRequestExtra{MediaHandle: mediaHandle})
	}

	resp, err := c.WAClient.SendMessage(ctx, jid, msg, extra...)
	if err != nil {
		return "", fmt.Errorf("failed to send media: %w", err)
	}

	return resp.ID, nil
}

func (c *Client) SendPoll(req PollRequest) (string, error) {
	ctx, cancel := waCtx()
	defer cancel()
	jid, err := parseJID(req.To)
	if err != nil {
		return "", err
	}

	maxSelections := req.MaxSelections
	if maxSelections <= 0 {
		maxSelections = 1
	}

	pollMsg := c.WAClient.BuildPollCreation(req.Question, req.Options, maxSelections)
	resp, err := c.WAClient.SendMessage(ctx, jid, pollMsg)
	if err != nil {
		return "", fmt.Errorf("failed to send poll: %w", err)
	}

	return resp.ID, nil
}

func (c *Client) SendStatus(req StatusRequest) (string, error) {
	ctx, cancel := waCtx()
	defer cancel()
	statusJID := types.StatusBroadcastJID

	msg := &waE2E.Message{
		ExtendedTextMessage: &waE2E.ExtendedTextMessage{
			Text:           proto.String(req.Text),
			BackgroundArgb: proto.Uint32(parseColor(req.BackgroundColor)),
			Font:           waE2E.ExtendedTextMessage_FontType(req.Font).Enum(),
		},
	}

	resp, err := c.WAClient.SendMessage(ctx, statusJID, msg)
	if err != nil {
		return "", fmt.Errorf("failed to send status: %w", err)
	}

	return resp.ID, nil
}

// React reage a uma mensagem (emoji; string vazia remove a reação).
func (c *Client) React(to, messageID, sender, emoji string, fromMe bool) (string, error) {
	ctx, cancel := waCtx()
	defer cancel()
	chat, err := parseJID(to)
	if err != nil {
		return "", err
	}

	var senderJID types.JID
	switch {
	case fromMe:
		if c.WAClient.Store.ID == nil {
			return "", fmt.Errorf("client not logged in")
		}
		senderJID = *c.WAClient.Store.ID
	case sender != "":
		senderJID, err = parseJID(sender)
		if err != nil {
			return "", err
		}
	default:
		senderJID = chat
	}

	reactMsg := c.WAClient.BuildReaction(chat, senderJID, messageID, emoji)
	resp, err := c.WAClient.SendMessage(ctx, chat, reactMsg)
	if err != nil {
		return "", fmt.Errorf("failed to react: %w", err)
	}
	return resp.ID, nil
}

// Edit substitui o texto de uma mensagem já enviada (só a própria).
func (c *Client) Edit(to, messageID, text string) (string, error) {
	ctx, cancel := waCtx()
	defer cancel()
	chat, err := parseJID(to)
	if err != nil {
		return "", err
	}

	newContent := &waE2E.Message{
		ExtendedTextMessage: &waE2E.ExtendedTextMessage{
			Text: proto.String(text),
		},
	}

	editMsg := c.WAClient.BuildEdit(chat, messageID, newContent)
	resp, err := c.WAClient.SendMessage(ctx, chat, editMsg)
	if err != nil {
		return "", fmt.Errorf("failed to edit: %w", err)
	}
	return resp.ID, nil
}

func (c *Client) DeleteMessages(to string, ids []string, forEveryone bool) (int, int, error) {
	ctx, cancel := waCtx()
	defer cancel()
	jid, err := parseJID(to)
	if err != nil {
		return 0, 0, err
	}

	var success, failed int
	for _, id := range ids {
		revokeMsg := c.WAClient.BuildRevoke(jid, types.EmptyJID, id)
		_, err = c.WAClient.SendMessage(ctx, jid, revokeMsg)
		if err != nil {
			failed++
			c.Logger.Warn().Err(err).Str("message_id", id).Msg("failed to delete message")
		} else {
			success++
		}
	}

	return success, failed, nil
}

func (c *Client) CreateCommunity(req CommunityRequest) (*CommunityInfo, error) {
	ctx, cancel := waCtx()
	defer cancel()

	// Create the community (parent group)
	communityInfo, err := c.WAClient.CreateGroup(ctx, whatsmeow.ReqCreateGroup{
		Name:         req.Name,
		Participants: []types.JID{},
		GroupParent:  types.GroupParent{IsParent: true},
	})
	if err != nil {
		return nil, fmt.Errorf("failed to create community: %w", err)
	}

	info := &CommunityInfo{
		CommunityJID: communityInfo.JID.String(),
	}

	// Create sub-groups linked to the community
	for _, name := range req.GroupNames {
		groupInfo, err := c.WAClient.CreateGroup(ctx, whatsmeow.ReqCreateGroup{
			Name:              name,
			Participants:      []types.JID{},
			GroupLinkedParent: types.GroupLinkedParent{LinkedParentJID: communityInfo.JID},
		})
		if err != nil {
			c.Logger.Error().Err(err).Str("group_name", name).Msg("failed to create sub-group")
			continue
		}
		info.GroupJIDs = append(info.GroupJIDs, groupInfo.JID.String())
	}

	return info, nil
}

type CommunityListItem struct {
	JID         string   `json:"jid"`
	Name        string   `json:"name"`
	Description string   `json:"description,omitempty"`
	OwnerJID    string   `json:"owner_jid"`
	IsAdmin     bool     `json:"is_admin"`
	IsOwner     bool     `json:"is_owner"`
	MemberCount int      `json:"member_count"`
	SubGroups   []string `json:"sub_groups,omitempty"`
	Members     []Member `json:"members,omitempty"`
}

// ListCommunities returns communities from cache if available, otherwise returns nil
// The caller should check the sync status and trigger SyncCommunities if needed
func (c *Client) ListCommunities(onlyAdmin bool, includeMembers bool) ([]CommunityListItem, error) {
	// Try cache first
	if cached, ok := c.GetCachedCommunities(onlyAdmin, includeMembers); ok {
		return cached, nil
	}

	// Cache miss - fetch synchronously (fallback for first call or expired cache)
	communities, err := c.fetchCommunities()
	if err != nil {
		return nil, err
	}

	// Save to cache
	c.communityMu.Lock()
	c.communityCache = communities
	c.communitySyncAt = time.Now()
	c.communitySyncStatus = CommunitySyncStatusReady
	c.communityMu.Unlock()

	// Filter
	var result []CommunityListItem
	for _, item := range communities {
		if onlyAdmin && !item.IsAdmin {
			continue
		}
		if !includeMembers {
			copy := item
			copy.Members = nil
			result = append(result, copy)
		} else {
			result = append(result, item)
		}
	}
	return result, nil
}

// fetchCommunities does the actual heavy lifting - calls WhatsApp and processes everything
func (c *Client) fetchCommunities() ([]CommunityListItem, error) {
	ctx, cancel := waCtx()
	defer cancel()
	groups, err := c.WAClient.GetJoinedGroups(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to get joined groups: %w", err)
	}

	// Collect all identifiers that belong to me
	myUsers := make(map[string]bool)
	if c.WAClient.Store.ID != nil {
		myUsers[c.WAClient.Store.ID.User] = true
	}
	if !c.WAClient.Store.LID.IsEmpty() {
		myUsers[c.WAClient.Store.LID.User] = true
	}

	var communities []CommunityListItem

	for _, g := range groups {
		if !g.IsParent {
			continue
		}

		isAdmin := false
		isOwner := false
		for _, p := range g.Participants {
			if myUsers[p.JID.User] {
				isAdmin = p.IsAdmin || p.IsSuperAdmin
				isOwner = p.IsSuperAdmin
				break
			}
		}
		if !isOwner && myUsers[g.OwnerJID.User] {
			isOwner = true
			isAdmin = true
		}

		item := CommunityListItem{
			JID:         g.JID.String(),
			Name:        g.Name,
			Description: g.Topic,
			OwnerJID:    c.resolveLID(g.OwnerJID),
			IsAdmin:     isAdmin,
			IsOwner:     isOwner,
			MemberCount: len(g.Participants),
		}

		// Find sub-groups
		var subGroups []types.GroupInfo
		for i, sg := range groups {
			if sg.LinkedParentJID == g.JID {
				item.SubGroups = append(item.SubGroups, sg.JID.String())
				subGroups = append(subGroups, *groups[i])
			}
		}

		// Always include members in cache (filter on read)
		seen := make(map[string]bool)
		var members []Member

		addParticipants := func(participants []types.GroupParticipant, ownerJID types.JID) {
			for _, p := range participants {
				jidStr := c.resolveLID(p.JID)
				if seen[jidStr] {
					continue
				}
				seen[jidStr] = true
				members = append(members, Member{
					JID:     jidStr,
					IsAdmin: p.IsAdmin || p.IsSuperAdmin,
					IsOwner: p.JID == ownerJID || p.IsSuperAdmin,
				})
			}
		}

		addParticipants(g.Participants, g.OwnerJID)
		for _, sg := range subGroups {
			addParticipants(sg.Participants, sg.OwnerJID)
		}

		item.Members = members
		item.MemberCount = len(members)

		communities = append(communities, item)
	}

	return communities, nil
}

const waQueryTimeout = 15 * time.Second

func waCtx() (context.Context, context.CancelFunc) {
	return context.WithTimeout(context.Background(), waQueryTimeout)
}

type InviteLinkResult struct {
	JID  string `json:"jid"`
	Name string `json:"name"`
	Link string `json:"link"`
}

func (c *Client) GetInviteLink(jidStr string) ([]InviteLinkResult, error) {
	ctx, cancel := waCtx()
	defer cancel()

	jid, err := parseJID(jidStr)
	if err != nil {
		return nil, err
	}

	// Check if this is a community (parent group)
	groupInfo, err := c.WAClient.GetGroupInfo(ctx, jid)
	if err != nil {
		return nil, fmt.Errorf("failed to get group info: %w", err)
	}

	if !groupInfo.IsParent {
		// Regular group - return single link
		link, err := c.WAClient.GetGroupInviteLink(ctx, jid, false)
		if err != nil {
			return nil, fmt.Errorf("failed to get invite link: %w", err)
		}
		return []InviteLinkResult{{
			JID:  jid.String(),
			Name: groupInfo.Name,
			Link: link,
		}}, nil
	}

	// Community - get invite links for all sub-groups
	groups, err := c.WAClient.GetJoinedGroups(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to get joined groups: %w", err)
	}

	var results []InviteLinkResult
	for _, sg := range groups {
		if sg.LinkedParentJID != jid {
			continue
		}
		link, err := c.WAClient.GetGroupInviteLink(ctx, sg.JID, false)
		if err != nil {
			c.Logger.Warn().Err(err).Str("group", sg.JID.String()).Msg("failed to get sub-group invite link")
			continue
		}
		results = append(results, InviteLinkResult{
			JID:  sg.JID.String(),
			Name: sg.Name,
			Link: link,
		})
	}

	return results, nil
}

func (c *Client) DeleteCommunity(jidStr string) error {
	ctx, cancel := waCtx()
	defer cancel()
	jid, err := parseJID(jidStr)
	if err != nil {
		return err
	}

	err = c.WAClient.LeaveGroup(ctx, jid)
	if err != nil {
		return fmt.Errorf("failed to delete community: %w", err)
	}

	return nil
}

func (c *Client) PromoteAdmins(jidStr string, participants []string) error {
	ctx, cancel := waCtx()
	defer cancel()
	jid, err := parseJID(jidStr)
	if err != nil {
		return err
	}

	participantJIDs, err := parseJIDs(participants)
	if err != nil {
		return err
	}

	_, err = c.WAClient.UpdateGroupParticipants(ctx, jid, participantJIDs, whatsmeow.ParticipantChangePromote)
	if err != nil {
		return fmt.Errorf("failed to promote admins: %w", err)
	}
	return nil
}

func (c *Client) DemoteAdmins(jidStr string, participants []string) error {
	ctx, cancel := waCtx()
	defer cancel()
	jid, err := parseJID(jidStr)
	if err != nil {
		return err
	}

	participantJIDs, err := parseJIDs(participants)
	if err != nil {
		return err
	}

	_, err = c.WAClient.UpdateGroupParticipants(ctx, jid, participantJIDs, whatsmeow.ParticipantChangeDemote)
	if err != nil {
		return fmt.Errorf("failed to demote admins: %w", err)
	}
	return nil
}

func (c *Client) UpdateGroupInfo(jidStr string, req UpdateGroupRequest) error {
	ctx, cancel := waCtx()
	defer cancel()
	jid, err := parseJID(jidStr)
	if err != nil {
		return err
	}

	if req.Name != nil {
		if err := c.WAClient.SetGroupName(ctx, jid, *req.Name); err != nil {
			return fmt.Errorf("failed to update group name: %w", err)
		}
	}

	if req.Description != nil {
		if err := c.WAClient.SetGroupTopic(ctx, jid, "", "", *req.Description); err != nil {
			return fmt.Errorf("failed to update group description: %w", err)
		}
	}

	return nil
}

func (c *Client) GetMembers(jidStr string) ([]Member, error) {
	ctx, cancel := waCtx()
	defer cancel()
	jid, err := parseJID(jidStr)
	if err != nil {
		return nil, err
	}

	groupInfo, err := c.WAClient.GetGroupInfo(ctx, jid)
	if err != nil {
		return nil, fmt.Errorf("failed to get group info: %w", err)
	}

	members := make([]Member, 0, len(groupInfo.Participants))
	for _, p := range groupInfo.Participants {
		members = append(members, Member{
			JID:     c.resolveLID(p.JID),
			IsAdmin: p.IsAdmin || p.IsSuperAdmin,
			IsOwner: p.IsSuperAdmin,
		})
	}

	return members, nil
}

// ── Profile ──

type ProfileInfo struct {
	JID         string `json:"jid"`
	Name        string `json:"name"`
	Status      string `json:"status"`
	PictureURL  string `json:"picture_url,omitempty"`
	PictureID   string `json:"picture_id,omitempty"`
	PhoneNumber string `json:"phone_number"`
}

type UpdateProfileRequest struct {
	Name     string `json:"name,omitempty"`
	Status   string `json:"status,omitempty"`
	PhotoURL string `json:"photo_url,omitempty"` // URL to download JPEG from
}

// ── Regular groups ──────────────────────────────────────────────

type GroupParticipantInfo struct {
	ID   string `json:"id"`
	Role string `json:"role"` // member | admin | superadmin
}

type GroupInfoResponse struct {
	JID          string                 `json:"jid"`
	Subject      string                 `json:"subject"`
	Description  string                 `json:"description,omitempty"`
	Owner        string                 `json:"owner,omitempty"`
	Participants []GroupParticipantInfo `json:"participants"`
	Size         int                    `json:"size"`
	Creation     int64                  `json:"creation,omitempty"`
	Announce     bool                   `json:"announce"`
	Restrict     bool                   `json:"restrict"`
	IsCommunity  bool                   `json:"isCommunity"`
}

type GroupParticipantResult struct {
	JID    string `json:"jid"`
	Status string `json:"status"`
}

func (c *Client) groupInfoToResponse(g *types.GroupInfo) GroupInfoResponse {
	parts := make([]GroupParticipantInfo, 0, len(g.Participants))
	for _, p := range g.Participants {
		role := "member"
		switch {
		case p.IsSuperAdmin:
			role = "superadmin"
		case p.IsAdmin:
			role = "admin"
		}
		parts = append(parts, GroupParticipantInfo{ID: c.resolveLID(p.JID), Role: role})
	}
	return GroupInfoResponse{
		JID:          g.JID.String(),
		Subject:      g.Name,
		Description:  g.Topic,
		Owner:        c.resolveLID(g.OwnerJID),
		Participants: parts,
		Size:         len(g.Participants),
		Creation:     g.GroupCreated.Unix(),
		Announce:     g.IsAnnounce,
		Restrict:     g.IsLocked,
		IsCommunity:  g.IsParent,
	}
}

// ListGroups returns every group the account participates in.
func (c *Client) ListGroups() ([]GroupInfoResponse, error) {
	ctx, cancel := waCtx()
	defer cancel()
	groups, err := c.WAClient.GetJoinedGroups(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to list groups: %w", err)
	}
	result := make([]GroupInfoResponse, 0, len(groups))
	for _, g := range groups {
		result = append(result, c.groupInfoToResponse(g))
	}
	return result, nil
}

func (c *Client) GroupInfo(jidStr string) (*GroupInfoResponse, error) {
	jid, err := parseJID(jidStr)
	if err != nil {
		return nil, err
	}
	ctx, cancel := waCtx()
	defer cancel()
	g, err := c.WAClient.GetGroupInfo(ctx, jid)
	if err != nil {
		return nil, fmt.Errorf("failed to get group info: %w", err)
	}
	res := c.groupInfoToResponse(g)
	return &res, nil
}

func (c *Client) CreateGroup(subject string, participants []string) (*GroupInfoResponse, error) {
	pjids, err := parseJIDs(participants)
	if err != nil {
		return nil, err
	}
	ctx, cancel := waCtx()
	defer cancel()
	g, err := c.WAClient.CreateGroup(ctx, whatsmeow.ReqCreateGroup{
		Name:         subject,
		Participants: pjids,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to create group: %w", err)
	}
	res := c.groupInfoToResponse(g)
	return &res, nil
}

func (c *Client) UpdateGroupParticipants(jidStr string, participants []string, action string) ([]GroupParticipantResult, error) {
	jid, err := parseJID(jidStr)
	if err != nil {
		return nil, err
	}
	pjids, err := parseJIDs(participants)
	if err != nil {
		return nil, err
	}
	var change whatsmeow.ParticipantChange
	switch action {
	case "add":
		change = whatsmeow.ParticipantChangeAdd
	case "remove":
		change = whatsmeow.ParticipantChangeRemove
	case "promote":
		change = whatsmeow.ParticipantChangePromote
	case "demote":
		change = whatsmeow.ParticipantChangeDemote
	default:
		return nil, fmt.Errorf("invalid action: %s (use add|remove|promote|demote)", action)
	}
	ctx, cancel := waCtx()
	defer cancel()
	res, err := c.WAClient.UpdateGroupParticipants(ctx, jid, pjids, change)
	if err != nil {
		return nil, fmt.Errorf("failed to update participants: %w", err)
	}
	out := make([]GroupParticipantResult, 0, len(res))
	for _, r := range res {
		status := "200"
		if r.Error != 0 {
			status = fmt.Sprintf("%d", r.Error)
		}
		out = append(out, GroupParticipantResult{JID: c.resolveLID(r.JID), Status: status})
	}
	return out, nil
}

func (c *Client) SetGroupSubject(jidStr, subject string) error {
	jid, err := parseJID(jidStr)
	if err != nil {
		return err
	}
	ctx, cancel := waCtx()
	defer cancel()
	return c.WAClient.SetGroupName(ctx, jid, subject)
}

func (c *Client) SetGroupDescription(jidStr, description string) error {
	jid, err := parseJID(jidStr)
	if err != nil {
		return err
	}
	ctx, cancel := waCtx()
	defer cancel()
	return c.WAClient.SetGroupTopic(ctx, jid, "", "", description)
}

func (c *Client) SetGroupSetting(jidStr, setting string) error {
	jid, err := parseJID(jidStr)
	if err != nil {
		return err
	}
	ctx, cancel := waCtx()
	defer cancel()
	switch setting {
	case "announcement":
		return c.WAClient.SetGroupAnnounce(ctx, jid, true)
	case "not_announcement":
		return c.WAClient.SetGroupAnnounce(ctx, jid, false)
	case "locked":
		return c.WAClient.SetGroupLocked(ctx, jid, true)
	case "unlocked":
		return c.WAClient.SetGroupLocked(ctx, jid, false)
	default:
		return fmt.Errorf("invalid setting: %s", setting)
	}
}

// GroupInviteLink returns the invite link; reset=true revokes and regenerates it.
func (c *Client) GroupInviteLink(jidStr string, reset bool) (string, error) {
	jid, err := parseJID(jidStr)
	if err != nil {
		return "", err
	}
	ctx, cancel := waCtx()
	defer cancel()
	return c.WAClient.GetGroupInviteLink(ctx, jid, reset)
}

func (c *Client) JoinGroup(code string) (string, error) {
	ctx, cancel := waCtx()
	defer cancel()
	jid, err := c.WAClient.JoinGroupWithLink(ctx, code)
	if err != nil {
		return "", fmt.Errorf("failed to join group: %w", err)
	}
	return jid.String(), nil
}

func (c *Client) LeaveGroup(jidStr string) error {
	jid, err := parseJID(jidStr)
	if err != nil {
		return err
	}
	ctx, cancel := waCtx()
	defer cancel()
	return c.WAClient.LeaveGroup(ctx, jid)
}

// ── Labels (WhatsApp Business) ──────────────────────────────────

type LabelInfo struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Color int    `json:"color"`
}

// ProcessAppStateEvent captura as mutações de etiqueta (app-state) num store local.
// O whatsmeow não expõe GetLabels(); as etiquetas chegam por evento.
func (c *Client) ProcessAppStateEvent(evt interface{}) {
	switch v := evt.(type) {
	case *events.Connected:
		// Full-sync da coleção `regular` (etiquetas) no connect: re-emite as
		// existentes e faz o whatsmeow pedir a app-state key ao celular se faltar.
		go c.SyncLabels()
	case *events.LabelEdit:
		c.labelMu.Lock()
		if c.labelStore == nil {
			c.labelStore = map[string]LabelInfo{}
		}
		if v.Action.GetDeleted() {
			delete(c.labelStore, v.LabelID)
		} else {
			c.labelStore[v.LabelID] = LabelInfo{
				ID:    v.LabelID,
				Name:  v.Action.GetName(),
				Color: int(v.Action.GetColor()),
			}
		}
		c.labelMu.Unlock()
	case *events.LabelAssociationChat:
		c.labelMu.Lock()
		if c.labelAssoc == nil {
			c.labelAssoc = map[string]map[string]bool{}
		}
		set := c.labelAssoc[v.LabelID]
		if set == nil {
			set = map[string]bool{}
			c.labelAssoc[v.LabelID] = set
		}
		if v.Action.GetLabeled() {
			set[v.JID.String()] = true
		} else {
			delete(set, v.JID.String())
		}
		c.labelMu.Unlock()
	}
}

// SyncLabels força um full-sync da coleção `regular` do app-state (etiquetas).
// Best-effort: se faltar a app-state key, o whatsmeow a solicita ao celular.
func (c *Client) SyncLabels() {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if err := c.WAClient.FetchAppState(ctx, appstate.WAPatchRegular, true, false); err != nil {
		c.Logger.Warn().Err(err).Msg("failed to sync labels (app-state)")
	}
}

func (c *Client) ListLabels() []LabelInfo {
	c.labelMu.RLock()
	defer c.labelMu.RUnlock()
	out := make([]LabelInfo, 0, len(c.labelStore))
	for _, l := range c.labelStore {
		out = append(out, l)
	}
	return out
}

func (c *Client) GetChatLabels(chatJID string) []LabelInfo {
	c.labelMu.RLock()
	defer c.labelMu.RUnlock()
	out := make([]LabelInfo, 0)
	for id, set := range c.labelAssoc {
		if set[chatJID] {
			if l, ok := c.labelStore[id]; ok {
				out = append(out, l)
			} else {
				out = append(out, LabelInfo{ID: id})
			}
		}
	}
	return out
}

func (c *Client) GetLabelChats(labelID string) []string {
	c.labelMu.RLock()
	defer c.labelMu.RUnlock()
	out := make([]string, 0)
	for jid := range c.labelAssoc[labelID] {
		out = append(out, jid)
	}
	return out
}

func (c *Client) UpsertLabel(id, name string, color int) (LabelInfo, error) {
	if id == "" {
		id = fmt.Sprintf("%d", time.Now().UnixNano())
	}
	ctx, cancel := waCtx()
	defer cancel()
	if err := c.WAClient.SendAppState(ctx, appstate.BuildLabelEdit(id, name, int32(color), false)); err != nil {
		return LabelInfo{}, fmt.Errorf("failed to upsert label: %w", err)
	}
	label := LabelInfo{ID: id, Name: name, Color: color}
	c.labelMu.Lock()
	if c.labelStore == nil {
		c.labelStore = map[string]LabelInfo{}
	}
	c.labelStore[id] = label
	c.labelMu.Unlock()
	return label, nil
}

func (c *Client) DeleteLabel(id string) error {
	c.labelMu.RLock()
	existing := c.labelStore[id]
	c.labelMu.RUnlock()
	ctx, cancel := waCtx()
	defer cancel()
	if err := c.WAClient.SendAppState(ctx, appstate.BuildLabelEdit(id, existing.Name, int32(existing.Color), true)); err != nil {
		return fmt.Errorf("failed to delete label: %w", err)
	}
	c.labelMu.Lock()
	delete(c.labelStore, id)
	c.labelMu.Unlock()
	return nil
}

func (c *Client) SetChatLabel(chatJIDStr, labelID string, on bool) error {
	jid, err := parseJID(chatJIDStr)
	if err != nil {
		return err
	}
	ctx, cancel := waCtx()
	defer cancel()
	if err := c.WAClient.SendAppState(ctx, appstate.BuildLabelChat(jid, labelID, on)); err != nil {
		return fmt.Errorf("failed to set chat label: %w", err)
	}
	c.labelMu.Lock()
	if c.labelAssoc == nil {
		c.labelAssoc = map[string]map[string]bool{}
	}
	set := c.labelAssoc[labelID]
	if set == nil {
		set = map[string]bool{}
		c.labelAssoc[labelID] = set
	}
	if on {
		set[jid.String()] = true
	} else {
		delete(set, jid.String())
	}
	c.labelMu.Unlock()
	return nil
}

func (c *Client) GetProfile() (*ProfileInfo, error) {
	ctx, cancel := waCtx()
	defer cancel()
	myJID := *c.WAClient.Store.ID

	info := &ProfileInfo{
		JID:         myJID.String(),
		PhoneNumber: myJID.User,
	}

	// Get push name from store
	if c.WAClient.Store.PushName != "" {
		info.Name = c.WAClient.Store.PushName
	}

	// Get status and picture via GetUserInfo
	userInfo, err := c.WAClient.GetUserInfo(ctx, []types.JID{myJID})
	if err == nil {
		if ui, ok := userInfo[myJID]; ok {
			info.Status = ui.Status
			info.PictureID = ui.PictureID
		}
	}

	// Get picture URL
	pic, err := c.WAClient.GetProfilePictureInfo(ctx, myJID, &whatsmeow.GetProfilePictureParams{})
	if err == nil && pic != nil {
		info.PictureURL = pic.URL
	}

	return info, nil
}

func (c *Client) UpdateProfile(req UpdateProfileRequest) error {
	ctx, cancel := waCtx()
	defer cancel()

	if req.Name != "" {
		if err := c.WAClient.SendAppState(ctx, appstate.BuildSettingPushName(req.Name)); err != nil {
			return fmt.Errorf("failed to update name: %w", err)
		}
	}

	if req.Status != "" {
		if err := c.WAClient.SetStatusMessage(ctx, req.Status); err != nil {
			return fmt.Errorf("failed to update status: %w", err)
		}
	}

	if req.PhotoURL != "" {
		photoData, err := downloadMedia(req.PhotoURL)
		if err != nil {
			return fmt.Errorf("failed to download photo: %w", err)
		}
		myJID := *c.WAClient.Store.ID
		if _, err := c.WAClient.SetGroupPhoto(ctx, myJID, photoData); err != nil {
			return fmt.Errorf("failed to update photo: %w", err)
		}
	}

	return nil
}

// ── Community edit ──

type UpdateCommunityRequest struct {
	Name        *string `json:"name,omitempty"`
	Description *string `json:"description,omitempty"`
	PhotoURL    *string `json:"photo_url,omitempty"` // URL to download JPEG from
}

func (c *Client) UpdateCommunity(jidStr string, req UpdateCommunityRequest) error {
	ctx, cancel := waCtx()
	defer cancel()
	jid, err := parseJID(jidStr)
	if err != nil {
		return err
	}

	if req.Name != nil {
		if err := c.WAClient.SetGroupName(ctx, jid, *req.Name); err != nil {
			return fmt.Errorf("failed to update name: %w", err)
		}
	}

	if req.Description != nil {
		if err := c.WAClient.SetGroupTopic(ctx, jid, "", "", *req.Description); err != nil {
			return fmt.Errorf("failed to update description: %w", err)
		}
	}

	if req.PhotoURL != nil {
		photoData, err := downloadMedia(*req.PhotoURL)
		if err != nil {
			return fmt.Errorf("failed to download photo: %w", err)
		}
		if _, err := c.WAClient.SetGroupPhoto(ctx, jid, photoData); err != nil {
			return fmt.Errorf("failed to update photo: %w", err)
		}
	}

	return nil
}

func (c *Client) DeleteCommunityFull(jidStr string) error {
	ctx, cancel := waCtx()
	defer cancel()
	jid, err := parseJID(jidStr)
	if err != nil {
		return err
	}

	// Get group info to find sub-groups
	groups, err := c.WAClient.GetJoinedGroups(ctx)
	if err == nil {
		for _, g := range groups {
			if g.LinkedParentJID == jid {
				// Unlink and leave sub-group
				_ = c.WAClient.UnlinkGroup(ctx, jid, g.JID)
				_ = c.WAClient.LeaveGroup(ctx, g.JID)
			}
		}
	}

	// Leave the community itself
	if err := c.WAClient.LeaveGroup(ctx, jid); err != nil {
		return fmt.Errorf("failed to delete community: %w", err)
	}

	return nil
}

// resolveLID converts a LID JID to a phone number JID if possible
func (c *Client) resolveLID(jid types.JID) string {
	if jid.Server == "lid" {
		pn, err := c.WAClient.Store.LIDs.GetPNForLID(context.Background(), jid)
		if err == nil && !pn.IsEmpty() {
			return pn.String()
		}
	}
	return jid.String()
}

func parseJIDs(jidStrs []string) ([]types.JID, error) {
	jids := make([]types.JID, 0, len(jidStrs))
	for _, s := range jidStrs {
		jid, err := parseJID(s)
		if err != nil {
			return nil, err
		}
		jids = append(jids, jid)
	}
	return jids, nil
}

func downloadMedia(url string) ([]byte, error) {
	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Get(url)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("failed to download media: HTTP %d", resp.StatusCode)
	}

	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	return data, nil
}

func setContextInfo(msg *waE2E.Message, replyTo string) {
	ctxInfo := &waE2E.ContextInfo{
		StanzaID: proto.String(replyTo),
	}

	if msg.ImageMessage != nil {
		msg.ImageMessage.ContextInfo = ctxInfo
	} else if msg.VideoMessage != nil {
		msg.VideoMessage.ContextInfo = ctxInfo
	} else if msg.AudioMessage != nil {
		msg.AudioMessage.ContextInfo = ctxInfo
	} else if msg.DocumentMessage != nil {
		msg.DocumentMessage.ContextInfo = ctxInfo
	}
}

func parseColor(hex string) uint32 {
	if hex == "" {
		return 0xFF1B5E20 // default dark green
	}
	var r, g, b uint8
	if len(hex) == 7 && hex[0] == '#' {
		fmt.Sscanf(hex, "#%02x%02x%02x", &r, &g, &b)
	}
	return uint32(0xFF)<<24 | uint32(r)<<16 | uint32(g)<<8 | uint32(b)
}

// ── Newsletters / Channels ──────────────────────────────────────

type NewsletterInfo struct {
	JID             string `json:"jid"`
	Name            string `json:"name"`
	Description     string `json:"description,omitempty"`
	SubscriberCount int    `json:"subscriber_count"`
	Role            string `json:"role,omitempty"`
	Muted           bool   `json:"muted"`
	InviteCode      string `json:"invite_code,omitempty"`
	PictureURL      string `json:"picture_url,omitempty"`
}

// newsletterInfoToResponse maps a whatsmeow NewsletterMetadata into the
// sidecar's public NewsletterInfo response shape.
func newsletterInfoToResponse(n *types.NewsletterMetadata) NewsletterInfo {
	info := NewsletterInfo{
		JID:             n.ID.String(),
		Name:            n.ThreadMeta.Name.Text,
		Description:     n.ThreadMeta.Description.Text,
		SubscriberCount: n.ThreadMeta.SubscriberCount,
		InviteCode:      n.ThreadMeta.InviteCode,
	}
	if n.ThreadMeta.Picture != nil {
		info.PictureURL = n.ThreadMeta.Picture.URL
	}
	if n.ViewerMeta != nil {
		info.Role = string(n.ViewerMeta.Role)
		info.Muted = n.ViewerMeta.Mute == types.NewsletterMuteOn
	}
	return info
}

// ListNewsletters returns all newsletters (channels) the user is subscribed to.
func (c *Client) ListNewsletters() ([]NewsletterInfo, error) {
	ctx, cancel := waCtx()
	defer cancel()

	newsletters, err := c.WAClient.GetSubscribedNewsletters(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to list newsletters: %w", err)
	}

	result := make([]NewsletterInfo, 0, len(newsletters))
	for _, n := range newsletters {
		result = append(result, newsletterInfoToResponse(n))
	}
	return result, nil
}

// NewsletterMetadata fetches info about a single newsletter by JID.
func (c *Client) NewsletterMetadata(jidStr string) (*NewsletterInfo, error) {
	ctx, cancel := waCtx()
	defer cancel()

	jid, err := parseJID(jidStr)
	if err != nil {
		return nil, err
	}

	n, err := c.WAClient.GetNewsletterInfo(ctx, jid)
	if err != nil {
		return nil, fmt.Errorf("failed to get newsletter info: %w", err)
	}

	info := newsletterInfoToResponse(n)
	return &info, nil
}

// CreateNewsletter creates a new WhatsApp channel. The newsletter-creation
// ToS notice is accepted proactively (best-effort, error ignored — it's an
// idempotent per-account acceptance, so calling it again when already
// accepted is harmless) before the first attempt. If the account has never
// created a channel before and the server still rejects the first attempt,
// this falls back to a reactive accept + single retry — see the
// AcceptTOSNotice doc comment upstream.
func (c *Client) CreateNewsletter(name, description string) (*NewsletterInfo, error) {
	ctx, cancel := waCtx()
	defer cancel()

	params := whatsmeow.CreateNewsletterParams{
		Name:        name,
		Description: description,
	}

	tosCtx, tosCancel := waCtx()
	_ = c.WAClient.AcceptTOSNotice(tosCtx, "20601218", "5")
	tosCancel()

	n, err := c.WAClient.CreateNewsletter(ctx, params)
	if err != nil {
		retryTosCtx, retryTosCancel := waCtx()
		_ = c.WAClient.AcceptTOSNotice(retryTosCtx, "20601218", "5")
		retryTosCancel()

		retryCtx, retryCancel := waCtx()
		n, err = c.WAClient.CreateNewsletter(retryCtx, params)
		retryCancel()
		if err != nil {
			return nil, fmt.Errorf("failed to create newsletter: %w", err)
		}
	}

	info := newsletterInfoToResponse(n)
	return &info, nil
}

// FollowNewsletter subscribes the user to a WhatsApp channel.
func (c *Client) FollowNewsletter(jidStr string) error {
	ctx, cancel := waCtx()
	defer cancel()

	jid, err := parseJID(jidStr)
	if err != nil {
		return err
	}

	if err := c.WAClient.FollowNewsletter(ctx, jid); err != nil {
		return fmt.Errorf("failed to follow newsletter: %w", err)
	}
	return nil
}

// UnfollowNewsletter unsubscribes the user from a WhatsApp channel.
func (c *Client) UnfollowNewsletter(jidStr string) error {
	ctx, cancel := waCtx()
	defer cancel()

	jid, err := parseJID(jidStr)
	if err != nil {
		return err
	}

	if err := c.WAClient.UnfollowNewsletter(ctx, jid); err != nil {
		return fmt.Errorf("failed to unfollow newsletter: %w", err)
	}
	return nil
}
