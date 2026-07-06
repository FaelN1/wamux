package instance

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"fmt"
	"sync"
	"time"

	"github.com/getsentry/sentry-go"
	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"encoding/json"

	"wamux_go/internal/chat"
	"wamux_go/internal/database"
	"wamux_go/internal/logger"
	"wamux_go/internal/msglog"
	"wamux_go/internal/proxy"
	"wamux_go/internal/webhook"
	"wamux_go/internal/whatsapp"
	"wamux_go/internal/ws"

	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/types/events"
	waLog "go.mau.fi/whatsmeow/util/log"
)

const (
	disconnectAlertDelay = 5 * time.Minute
	maxReconnectAttempts = 5
)

var reconnectBackoff = []time.Duration{5 * time.Second, 15 * time.Second, 30 * time.Second, 1 * time.Minute, 5 * time.Minute}

type Manager struct {
	mu               sync.RWMutex
	clients          map[string]*whatsapp.Client
	disconnectAlert  map[string]*time.Timer
	reconnectTimer   map[string]*time.Timer
	reconnectCount   map[string]int
	manualDisconnect map[string]bool // true if user clicked disconnect
	repo             Repository
	db               *sql.DB
	sessionDir       string
	logDir           string
	isDev            bool
	dispatcher       *webhook.Dispatcher
	hub              *ws.Hub
	proxyProvider    *proxy.Provider
	msgLog           *msglog.Store
	chatStore        *chat.Store
	log              zerolog.Logger
}

func NewManager(repo Repository, db *sql.DB, sessionDir, logDir string, isDev bool, dispatcher *webhook.Dispatcher, hub *ws.Hub, proxyProvider *proxy.Provider, msgLog *msglog.Store, chatStore *chat.Store, log zerolog.Logger) *Manager {
	return &Manager{
		clients:          make(map[string]*whatsapp.Client),
		disconnectAlert:  make(map[string]*time.Timer),
		reconnectTimer:   make(map[string]*time.Timer),
		reconnectCount:   make(map[string]int),
		manualDisconnect: make(map[string]bool),
		repo:             repo,
		db:               db,
		sessionDir:       sessionDir,
		logDir:           logDir,
		isDev:            isDev,
		dispatcher:       dispatcher,
		hub:              hub,
		proxyProvider:    proxyProvider,
		msgLog:           msgLog,
		chatStore:        chatStore,
		log:              log,
	}
}

func (m *Manager) CreateInstance(ctx context.Context, req CreateRequest) (*Instance, string, error) {
	id := uuid.New().String()
	apiKey, err := generateAPIKey()
	if err != nil {
		return nil, "", fmt.Errorf("failed to generate API key: %w", err)
	}

	webhookEvents := WebhookEvents(req.WebhookEvents)
	if webhookEvents == nil {
		webhookEvents = WebhookEvents{}
	}

	// Auto-assign proxy from Webshare if none provided
	proxyURL := req.ProxyURL
	if proxyURL == "" && m.proxyProvider.Enabled() {
		if assigned, err := m.proxyProvider.Assign(id); err != nil {
			m.log.Warn().Err(err).Str("instance_id", id).Msg("failed to auto-assign proxy")
		} else {
			proxyURL = assigned
		}
	}

	inst := &Instance{
		ID:            id,
		CompanyName:   req.CompanyName,
		SideName:      req.SideName,
		APIKey:        apiKey,
		WebhookURL:    req.WebhookURL,
		WebhookEvents: webhookEvents,
		ProxyURL:      proxyURL,
		Status:        StatusDisconnected,
		PhoneNumber:   req.PhoneNumber,
	}

	if err := m.repo.Create(ctx, inst); err != nil {
		return nil, "", fmt.Errorf("failed to create instance: %w", err)
	}

	m.log.Info().
		Str("instance_id", id).
		Str("company_name", req.CompanyName).
		Str("side_name", req.SideName).
		Msg("instance created")

	if req.PhoneNumber != "" {
		pairingCode, err := m.connectAndPair(ctx, inst)
		if err != nil {
			m.log.Error().Err(err).Str("instance_id", id).Msg("failed to auto-connect instance")
			return inst, "", nil
		}
		return inst, pairingCode, nil
	}

	return inst, "", nil
}

func (m *Manager) GetMsgLog() *msglog.Store {
	return m.msgLog
}

func (m *Manager) GetClient(instanceID string) (*whatsapp.Client, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	client, ok := m.clients[instanceID]
	if !ok {
		return nil, fmt.Errorf("client not found for instance %s", instanceID)
	}
	return client, nil
}

func (m *Manager) ConnectInstance(ctx context.Context, instanceID string) error {
	inst, err := m.repo.GetByID(ctx, instanceID)
	if err != nil {
		return err
	}

	_, err = m.connectAndPair(ctx, inst)
	return err
}

func (m *Manager) DisconnectInstance(ctx context.Context, instanceID string) error {
	m.mu.Lock()
	// Mark as manual disconnect to prevent auto-reconnect
	m.manualDisconnect[instanceID] = true
	// Cancel any pending reconnect
	if timer, ok := m.reconnectTimer[instanceID]; ok {
		timer.Stop()
		delete(m.reconnectTimer, instanceID)
	}
	delete(m.reconnectCount, instanceID)
	client, ok := m.clients[instanceID]
	if ok {
		// Logout clears credentials from the session store
		client.WAClient.Logout(context.Background())
		client.WAClient.Disconnect()
		delete(m.clients, instanceID)
	}
	m.mu.Unlock()

	if err := m.repo.UpdateStatus(ctx, instanceID, StatusDisconnected); err != nil {
		return fmt.Errorf("failed to update status: %w", err)
	}

	m.log.Info().Str("instance_id", instanceID).Msg("instance disconnected and logged out")
	return nil
}

type PairResult struct {
	QRChannel   <-chan whatsmeow.QRChannelItem
	PairingCode string
}

// ConnectForPairing disconnects/logouts any existing session, connects fresh,
// returns QR channel and (optionally) a pairing code if phone is provided.
func (m *Manager) ConnectForPairing(ctx context.Context, instanceID, phone string) (*PairResult, error) {
	// Disconnect existing client
	m.mu.Lock()
	if existing, ok := m.clients[instanceID]; ok {
		existing.WAClient.Disconnect()
		delete(m.clients, instanceID)
	}
	m.mu.Unlock()

	client, err := m.getOrCreateClient(ctx, instanceID)
	if err != nil {
		return nil, err
	}

	// If already logged in, logout to allow re-pairing
	if client.WAClient.Store.ID != nil {
		client.WAClient.Logout(context.Background())
		m.mu.Lock()
		delete(m.clients, instanceID)
		m.mu.Unlock()
		client, err = m.getOrCreateClient(ctx, instanceID)
		if err != nil {
			return nil, err
		}
	}

	// Get QR channel before connecting
	qrChan, _ := client.WAClient.GetQRChannel(context.Background())

	if err := client.WAClient.Connect(); err != nil {
		return nil, fmt.Errorf("failed to connect: %w", err)
	}

	result := &PairResult{QRChannel: qrChan}

	// If phone is available, also generate pairing code
	if phone != "" {
		code, err := client.WAClient.PairPhone(ctx, phone, true, whatsmeow.PairClientChrome, "Google Chrome (WAMux)")
		if err != nil {
			m.log.Warn().Err(err).Str("instance_id", instanceID).Msg("failed to generate pairing code, QR still available")
		} else {
			result.PairingCode = code
		}
	}

	if err := m.repo.UpdateStatus(ctx, instanceID, StatusConnecting); err != nil {
		m.log.Error().Err(err).Str("instance_id", instanceID).Msg("failed to update status")
	}

	return result, nil
}

func (m *Manager) ReconnectAll(ctx context.Context) error {
	instances, err := m.repo.GetAll(ctx)
	if err != nil {
		return fmt.Errorf("failed to get instances: %w", err)
	}

	var reconnected int
	for _, inst := range instances {
		if inst.Status == StatusConnected || inst.Status == StatusConnecting {
			if err := m.reconnect(ctx, inst); err != nil {
				m.log.Error().Err(err).
					Str("instance_id", inst.ID).
					Msg("failed to reconnect instance")
				continue
			}
			reconnected++
		}
	}

	m.log.Info().Int("reconnected", reconnected).Int("total", len(instances)).Msg("reconnection complete")
	return nil
}

func (m *Manager) DisconnectAll() {
	m.mu.Lock()
	defer m.mu.Unlock()

	for id, client := range m.clients {
		client.WAClient.Disconnect()
		m.log.Info().Str("instance_id", id).Msg("disconnected on shutdown")
	}
	m.clients = make(map[string]*whatsapp.Client)
}

func (m *Manager) reconnect(ctx context.Context, inst *Instance) error {
	// Re-assign proxy from Webshare if instance has no proxy configured
	if inst.ProxyURL == "" && m.proxyProvider.Enabled() {
		if assigned, err := m.proxyProvider.Assign(inst.ID); err == nil && assigned != "" {
			inst.ProxyURL = assigned
			_ = m.repo.Update(ctx, inst)
		}
	}

	client, err := m.createClient(inst)
	if err != nil {
		return err
	}

	if client.WAClient.Store.ID == nil {
		m.log.Warn().Str("instance_id", inst.ID).Msg("no session found, skipping reconnect")
		_ = m.repo.UpdateStatus(ctx, inst.ID, StatusDisconnected)
		return nil
	}

	// Sync phone number from session if different
	sessionPhone := client.WAClient.Store.ID.User
	if sessionPhone != "" && sessionPhone != inst.PhoneNumber {
		_ = m.repo.UpdatePhoneNumber(ctx, inst.ID, sessionPhone)
		inst.PhoneNumber = sessionPhone
		m.log.Info().Str("instance_id", inst.ID).Str("phone", sessionPhone).Msg("phone number synced from session")
	}

	if err := client.WAClient.Connect(); err != nil {
		return fmt.Errorf("failed to connect: %w", err)
	}

	m.mu.Lock()
	m.clients[inst.ID] = client
	m.mu.Unlock()

	return nil
}

func (m *Manager) connectAndPair(ctx context.Context, inst *Instance) (string, error) {
	client, err := m.getOrCreateClient(ctx, inst.ID)
	if err != nil {
		return "", err
	}

	if client.WAClient.Store.ID != nil {
		if err := client.WAClient.Connect(); err != nil {
			return "", fmt.Errorf("failed to connect: %w", err)
		}
		return "", nil
	}

	if err := client.WAClient.Connect(); err != nil {
		return "", fmt.Errorf("failed to connect: %w", err)
	}

	if inst.PhoneNumber != "" {
		code, err := client.WAClient.PairPhone(ctx, inst.PhoneNumber, true, whatsmeow.PairClientChrome, "Google Chrome (WAMux)")
		if err != nil {
			return "", fmt.Errorf("failed to pair phone: %w", err)
		}

		if err := m.repo.UpdateStatus(ctx, inst.ID, StatusConnecting); err != nil {
			m.log.Error().Err(err).Str("instance_id", inst.ID).Msg("failed to update status")
		}

		return code, nil
	}

	return "", nil
}

func (m *Manager) getOrCreateClient(ctx context.Context, instanceID string) (*whatsapp.Client, error) {
	m.mu.RLock()
	client, ok := m.clients[instanceID]
	m.mu.RUnlock()

	if ok {
		return client, nil
	}

	inst, err := m.repo.GetByID(ctx, instanceID)
	if err != nil {
		return nil, err
	}

	return m.createClient(inst)
}

func (m *Manager) createClient(inst *Instance) (*whatsapp.Client, error) {
	store, err := database.GetSQLiteStore(m.sessionDir, inst.ID)
	if err != nil {
		return nil, fmt.Errorf("failed to get sqlite store: %w", err)
	}

	deviceStore, err := store.GetFirstDevice(context.Background())
	if err != nil {
		return nil, fmt.Errorf("failed to get device store: %w", err)
	}

	instLogger := logger.NewInstanceLogger(m.logDir, inst.ID, m.isDev)

	waClient := whatsmeow.NewClient(deviceStore, waLog.Noop)

	// Configure proxy if set
	if inst.ProxyURL != "" {
		if err := waClient.SetProxyAddress(inst.ProxyURL); err != nil {
			m.log.Error().Err(err).
				Str("instance_id", inst.ID).
				Str("proxy_url", inst.ProxyURL).
				Msg("failed to set proxy, connecting without proxy")
		} else {
			m.log.Info().
				Str("instance_id", inst.ID).
				Str("proxy_url", inst.ProxyURL).
				Msg("proxy configured")
		}
	}

	client := &whatsapp.Client{
		WAClient:   waClient,
		InstanceID: inst.ID,
		Store:      store,
		Logger:     instLogger,
		OnCommunitySyncDone: func() {
			m.hub.Broadcast(ws.Event{
				Type: "COMMUNITY_SYNC_DONE",
				Data: map[string]string{"instance_id": inst.ID},
			})
		},
	}

	eventHandler := &whatsapp.EventHandler{
		InstanceID: inst.ID,
		Logger:     instLogger,
		OnConnected: func() {
			ctx := context.Background()
			_ = m.repo.UpdateStatus(ctx, inst.ID, StatusConnected)
			data := whatsapp.ConnectionStatusData{InstanceID: inst.ID, Status: StatusConnected}
			if raw, err := json.Marshal(data); err == nil {
				instLogger.Info().Str("event", whatsapp.EventConnectionStatus).RawJSON("data", raw).Msg("event received")
			}
			if inst.HasWebhookEvent(whatsapp.EventConnectionStatus) {
				_ = m.dispatcher.Dispatch(ctx, inst.ID, inst.WebhookURL, whatsapp.EventConnectionStatus, data)
			}
			m.hub.Broadcast(ws.Event{Type: whatsapp.EventConnectionStatus, Data: data})

			// Cancel disconnect alert and reconnect timers
			m.mu.Lock()
			if timer, ok := m.disconnectAlert[inst.ID]; ok {
				timer.Stop()
				delete(m.disconnectAlert, inst.ID)
			}
			if timer, ok := m.reconnectTimer[inst.ID]; ok {
				timer.Stop()
				delete(m.reconnectTimer, inst.ID)
			}
			delete(m.reconnectCount, inst.ID)
			delete(m.manualDisconnect, inst.ID)
			m.mu.Unlock()

			// Sync communities in background (delay to let connection stabilize)
			time.AfterFunc(5*time.Second, func() {
				if client.WAClient.IsConnected() {
					client.SyncCommunities()
				}
			})
		},
		OnPairSuccess: func(phone string) {
			ctx := context.Background()
			_ = m.repo.UpdatePhoneNumber(ctx, inst.ID, phone)
			inst.PhoneNumber = phone
			m.log.Info().Str("instance_id", inst.ID).Str("phone", phone).Msg("phone number updated from pairing")
		},
		OnDisconnected: func() {
			ctx := context.Background()
			_ = m.repo.UpdateStatus(ctx, inst.ID, StatusDisconnected)
			data := whatsapp.ConnectionStatusData{InstanceID: inst.ID, Status: StatusDisconnected}
			if raw, err := json.Marshal(data); err == nil {
				instLogger.Info().Str("event", whatsapp.EventConnectionStatus).RawJSON("data", raw).Msg("event received")
			}
			if inst.HasWebhookEvent(whatsapp.EventConnectionStatus) {
				_ = m.dispatcher.Dispatch(ctx, inst.ID, inst.WebhookURL, whatsapp.EventConnectionStatus, data)
			}
			m.hub.Broadcast(ws.Event{Type: whatsapp.EventConnectionStatus, Data: data})

			// Clear community cache on disconnect
			client.InvalidateCommunityCache()

			// Start disconnect alert timer
			m.mu.Lock()
			if timer, ok := m.disconnectAlert[inst.ID]; ok {
				timer.Stop()
			}
			m.disconnectAlert[inst.ID] = time.AfterFunc(disconnectAlertDelay, func() {
				m.mu.Lock()
				delete(m.disconnectAlert, inst.ID)
				m.mu.Unlock()

				// Check if still disconnected
				current, err := m.repo.GetByID(context.Background(), inst.ID)
				if err != nil || current.Status == StatusConnected {
					return
				}

				m.log.Error().
					Str("instance_id", inst.ID).
					Str("company_name", inst.CompanyName).
					Str("side_name", inst.SideName).
					Msg("CRITICAL: instance disconnected for more than 5 minutes")

				sentry.WithScope(func(scope *sentry.Scope) {
					scope.SetLevel(sentry.LevelFatal)
					scope.SetTag("instance_id", inst.ID)
					scope.SetTag("company_name", inst.CompanyName)
					scope.SetTag("side_name", inst.SideName)
					scope.SetTag("alert_type", "disconnect_timeout")
					sentry.CaptureMessage(fmt.Sprintf(
						"CRITICAL: Instance %s (%s/%s) disconnected for more than 5 minutes",
						inst.ID, inst.CompanyName, inst.SideName,
					))
				})
			})

			// Auto-reconnect (unless manually disconnected)
			if !m.manualDisconnect[inst.ID] {
				attempt := m.reconnectCount[inst.ID]
				if attempt < maxReconnectAttempts {
					delay := reconnectBackoff[attempt]
					m.reconnectCount[inst.ID] = attempt + 1
					m.log.Info().Str("instance_id", inst.ID).Int("attempt", attempt+1).Dur("delay", delay).Msg("auto-reconnect scheduled")
					m.reconnectTimer[inst.ID] = time.AfterFunc(delay, func() {
						m.mu.Lock()
						delete(m.reconnectTimer, inst.ID)
						m.mu.Unlock()

						if client.WAClient.Store.ID != nil {
							m.log.Info().Str("instance_id", inst.ID).Msg("auto-reconnecting...")
							if err := client.WAClient.Connect(); err != nil {
								m.log.Error().Err(err).Str("instance_id", inst.ID).Msg("auto-reconnect failed")
							}
						}
					})
				}
			}
			m.mu.Unlock()
		},
		OnMessage: func(evt *events.Message) {
			ctx := context.Background()
			data := whatsapp.BuildMessageData(waClient, evt, instLogger)
			if raw, err := json.Marshal(data); err == nil {
				instLogger.Info().Str("event", whatsapp.EventMessage).RawJSON("data", raw).Msg("event received")
			}
			if inst.HasWebhookEvent(whatsapp.EventMessage) {
				_ = m.dispatcher.Dispatch(ctx, inst.ID, inst.WebhookURL, whatsapp.EventMessage, data)
			}
			m.hub.Broadcast(ws.Event{Type: whatsapp.EventMessage, Data: data})
			// Log incoming message
			m.msgLog.LogIncoming(ctx, inst.ID, data.MessageID, data.Chat, data.From, data.Type, data.Text, data.HasMedia, data.MimeType)
			// Auto-upsert contact
			preview := data.Text
			if preview == "" && data.HasMedia {
				preview = "[" + data.Type + "]"
			}
			name := evt.Info.PushName
			m.chatStore.Upsert(ctx, inst.ID, data.Chat, name, evt.Info.Sender.User, data.IsGroup, preview, true)
		},
		OnReceipt: func(evt *events.Receipt) {
			ctx := context.Background()
			data := whatsapp.BuildMessageStatusData(waClient, evt)
			if raw, err := json.Marshal(data); err == nil {
				instLogger.Info().Str("event", whatsapp.EventMessageStatus).RawJSON("data", raw).Msg("event received")
			}
			if inst.HasWebhookEvent(whatsapp.EventMessageStatus) {
				_ = m.dispatcher.Dispatch(ctx, inst.ID, inst.WebhookURL, whatsapp.EventMessageStatus, data)
			}
			m.hub.Broadcast(ws.Event{Type: whatsapp.EventMessageStatus, Data: data})
		},
		OnGroupMembersEdit: func(evt *events.GroupInfo) {
			ctx := context.Background()
			edits := whatsapp.BuildGroupMembersEditData(evt)
			for _, data := range edits {
				if raw, err := json.Marshal(data); err == nil {
					instLogger.Info().Str("event", whatsapp.EventGroupMembersEdit).RawJSON("data", raw).Msg("event received")
				}
				if inst.HasWebhookEvent(whatsapp.EventGroupMembersEdit) {
					_ = m.dispatcher.Dispatch(ctx, inst.ID, inst.WebhookURL, whatsapp.EventGroupMembersEdit, data)
				}
				m.hub.Broadcast(ws.Event{Type: whatsapp.EventGroupMembersEdit, Data: data})
			}
			// Invalidate and re-sync community cache
			client.InvalidateCommunityCache()
			client.SyncCommunities()
		},
	}

	waClient.AddEventHandler(eventHandler.Handle)
	// Captura etiquetas (app-state) num store local para list/associação.
	waClient.AddEventHandler(client.ProcessAppStateEvent)

	m.mu.Lock()
	m.clients[inst.ID] = client
	m.mu.Unlock()

	return client, nil
}

// ExportDevice lê as credenciais do device (Multi-Device) da instância no
// formato canônico — para migrar de engine sem reparear.
func (m *Manager) ExportDevice(ctx context.Context, instanceID string) (*whatsapp.PortableCreds, error) {
	client, err := m.getOrCreateClient(ctx, instanceID)
	if err != nil {
		return nil, err
	}
	return whatsapp.ExportDevice(client.WAClient.Store)
}

// ImportDevice injeta credenciais canônicas no store SQLite da instância — o
// device passa a ser aquele já linkado (sem QR). Deve ser chamado ANTES de
// conectar. As sessões Signal re-sincronizam depois.
func (m *Manager) ImportDevice(ctx context.Context, instanceID string, c *whatsapp.PortableCreds) error {
	m.mu.Lock()
	if existing, ok := m.clients[instanceID]; ok {
		existing.WAClient.Disconnect()
		delete(m.clients, instanceID)
	}
	m.mu.Unlock()

	st, err := database.GetSQLiteStore(m.sessionDir, instanceID)
	if err != nil {
		return fmt.Errorf("sqlite store: %w", err)
	}
	dev, err := st.GetFirstDevice(context.Background())
	if err != nil {
		return fmt.Errorf("get device: %w", err)
	}
	if err := whatsapp.ApplyCreds(dev, c); err != nil {
		return err
	}
	// DEBUG: tamanhos dos campos antes do Save (whatsmeow tem CHECK constraints:
	// adv_key=32, adv_account_sig=64, adv_account_sig_key=32, adv_device_sig=64).
	le := m.log.Info().Str("instance_id", instanceID).
		Int("adv_key", len(dev.AdvSecretKey)).
		Int("adv_account_sig", len(dev.Account.AccountSignature)).
		Int("adv_account_sig_key", len(dev.Account.AccountSignatureKey)).
		Int("adv_device_sig", len(dev.Account.DeviceSignature)).
		Int("adv_details", len(dev.Account.Details))
	le.Msg("import: tamanhos dos campos do device (debug)")
	if err := dev.Save(context.Background()); err != nil {
		return fmt.Errorf("save device: %w", err)
	}
	_ = m.repo.UpdateStatus(ctx, instanceID, StatusDisconnected)
	m.log.Info().Str("instance_id", instanceID).Msg("credenciais de device importadas (migração)")
	return nil
}

// ConnectExisting conecta uma sessão JÁ registrada (device linkado) SEM gerar QR
// nem deslogar — ao contrário de ConnectForPairing. Usado logo após importar
// credenciais (migração de engine): o device já está pareado, só falta subir o
// socket. Os eventos (OnConnected → webhook) são disparados normalmente.
func (m *Manager) ConnectExisting(ctx context.Context, instanceID string) error {
	m.mu.Lock()
	if existing, ok := m.clients[instanceID]; ok {
		existing.WAClient.Disconnect()
		delete(m.clients, instanceID)
	}
	m.mu.Unlock()

	// getOrCreateClient recria o client (relê o device salvo do SQLite), fia os
	// event handlers e o registra em m.clients.
	client, err := m.getOrCreateClient(ctx, instanceID)
	if err != nil {
		return err
	}
	if client.WAClient.Store.ID == nil {
		return fmt.Errorf("sem sessão registrada (device não pareado)")
	}
	if err := client.WAClient.Connect(); err != nil {
		return fmt.Errorf("failed to connect: %w", err)
	}
	_ = m.repo.UpdateStatus(ctx, instanceID, StatusConnecting)
	m.log.Info().Str("instance_id", instanceID).Msg("sessão existente conectada (sem pairing)")
	return nil
}

func generateAPIKey() (string, error) {
	bytes := make([]byte, 32)
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}
	return hex.EncodeToString(bytes), nil
}
