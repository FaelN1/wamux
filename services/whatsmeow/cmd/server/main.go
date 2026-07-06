package main

import (
	"context"
	_ "embed"
	"encoding/json"
	"fmt"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/getsentry/sentry-go"
	sentryfiber "github.com/getsentry/sentry-go/fiber"
	"github.com/gofiber/fiber/v2"
	"github.com/joho/godotenv"
	"github.com/rs/zerolog/log"

	"wamux_go/internal/chat"
	"wamux_go/internal/config"
	"wamux_go/internal/database"
	"wamux_go/internal/handler"
	"wamux_go/internal/instance"
	"wamux_go/internal/logger"
	"wamux_go/internal/middleware"
	"wamux_go/internal/msglog"
	"wamux_go/internal/msgqueue"
	"wamux_go/internal/proxy"
	"wamux_go/internal/webhook"
	"wamux_go/internal/ws"

	"github.com/gofiber/contrib/websocket"
	"go.mau.fi/whatsmeow/proto/waCompanionReg"
	"go.mau.fi/whatsmeow/store"
	"google.golang.org/protobuf/proto"
)

//go:embed openapi.yaml
var openapiYAML []byte

//go:embed docs.html
var docsHTML []byte

func main() {
	_ = godotenv.Load()

	cfg, err := config.Load()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Failed to load config: %v\n", err)
		os.Exit(1)
	}

	// Initialize logger
	appLogger := logger.New(cfg.LogDir, cfg.LogLevel, cfg.IsDevelopment())

	// Initialize Sentry
	if cfg.SentryDSN != "" {
		tracesSampleRate := 0.2
		if cfg.IsDevelopment() {
			tracesSampleRate = 1.0
		}
		if err := sentry.Init(sentry.ClientOptions{
			Dsn:              cfg.SentryDSN,
			Environment:      cfg.AppEnv,
			Release:          cfg.AppVersion,
			TracesSampleRate: tracesSampleRate,
			EnableTracing:    true,
			EnableLogs:       true,
		}); err != nil {
			appLogger.Warn().Err(err).Msg("Sentry initialization failed")
		} else {
			appLogger.Info().Msg("Sentry initialized")
		}
	}

	// Configure WhatsApp device identity
	store.DeviceProps.Os = proto.String("WAMux")
	store.DeviceProps.PlatformType = waCompanionReg.DeviceProps_CHROME.Enum()

	// Connect to PostgreSQL
	db, err := database.ConnectPostgres(cfg.DatabaseURL)
	if err != nil {
		appLogger.Fatal().Err(err).Msg("Failed to connect to PostgreSQL")
	}
	defer db.Close()
	appLogger.Info().Msg("Connected to PostgreSQL")

	// Run migrations
	if err := database.RunMigrations(db); err != nil {
		appLogger.Fatal().Err(err).Msg("Failed to run migrations")
	}
	appLogger.Info().Msg("Migrations completed")

	// Initialize repositories
	instanceRepo := instance.NewRepository(db)
	deliveryRepo := webhook.NewDeliveryRepository(db)

	// Initialize webhook dispatcher
	dispatcher := webhook.NewDispatcher(deliveryRepo, appLogger)

	// Initialize WebSocket hub
	wsHub := ws.NewHub(appLogger)

	// Initialize proxy provider (Webshare)
	proxyProvider := proxy.NewProvider(cfg.WebshareAPIKey, appLogger)
	if proxyProvider.Enabled() {
		if err := proxyProvider.Refresh(); err != nil {
			appLogger.Error().Err(err).Msg("Failed to fetch Webshare proxies")
		}
	}

	// Initialize message log and chat store
	msgLogStore := msglog.NewStore(db)
	chatStore := chat.NewStore(db)

	// Initialize instance manager
	manager := instance.NewManager(instanceRepo, db, cfg.WhatsmeowSessionDir, cfg.LogDir, cfg.IsDevelopment(), dispatcher, wsHub, proxyProvider, msgLogStore, chatStore, appLogger)

	// Reconnect active instances
	ctx := context.Background()
	if err := manager.ReconnectAll(ctx); err != nil {
		appLogger.Error().Err(err).Msg("Failed to reconnect instances")
	}

	// Start webhook worker
	webhookStop := make(chan struct{})
	go dispatcher.StartWorker(5*time.Second, webhookStop)

	// Initialize Fiber
	app := fiber.New(fiber.Config{
		AppName:      "wamux_go",
		ErrorHandler: errorHandler,
	})

	// Sentry middleware - captures panics and provides per-request hub
	app.Use(sentryfiber.New(sentryfiber.Options{
		Repanic:         true,
		WaitForDelivery: false,
	}))

	// Enrich Sentry events with instance context
	app.Use(func(c *fiber.Ctx) error {
		if hub := sentryfiber.GetHubFromContext(c); hub != nil {
			hub.Scope().SetTag("environment", cfg.AppEnv)
			if inst := middleware.GetInstance(c); inst != nil {
				hub.Scope().SetTag("instance_id", inst.ID)
				hub.Scope().SetTag("company_name", inst.CompanyName)
				hub.Scope().SetTag("side_name", inst.SideName)
			}
		}
		return c.Next()
	})

	// Initialize message queue
	msgQueue := msgqueue.NewQueue(db, func(instanceID, msgType string, payload json.RawMessage) (string, error) {
		client, err := manager.GetClient(instanceID)
		if err != nil {
			return "", err
		}
		switch msgType {
		case "text":
			var p struct {
				To   string `json:"to"`
				Text string `json:"text"`
			}
			if err := json.Unmarshal(payload, &p); err != nil {
				return "", err
			}
			msgID, err := client.SendText(p.To, p.Text, "")
			if err == nil {
				msgLogStore.LogOutgoing(context.Background(), instanceID, msgID, p.To, "text", p.Text, false, "", "sent", "")
			}
			return msgID, err
		default:
			return "", fmt.Errorf("unsupported queue message type: %s", msgType)
		}
	}, appLogger)
	queueStop := make(chan struct{})
	go msgQueue.StartWorker(queueStop)

	// Initialize handlers
	instanceHandler := handler.NewInstanceHandler(manager, instanceRepo)
	messageHandler := handler.NewMessageHandler(manager, msgQueue)
	groupHandler := handler.NewGroupHandler(manager)
	labelHandler := handler.NewLabelHandler(manager)
	profileHandler := handler.NewProfileHandler(manager)
	chatHandler := handler.NewChatHandler(manager, chatStore)

	// Health check
	app.Get("/health", func(c *fiber.Ctx) error {
		return c.JSON(fiber.Map{
			"status":  "ok",
			"version": cfg.AppVersion,
		})
	})

	// API docs (painel administrativo removido — a UI fica no gateway)
	app.Get("/docs", func(c *fiber.Ctx) error {
		c.Set("Content-Type", "text/html; charset=utf-8")
		return c.Send(docsHTML)
	})
	app.Get("/openapi.yaml", func(c *fiber.Ctx) error {
		c.Set("Content-Type", "text/yaml; charset=utf-8")
		return c.Send(openapiYAML)
	})

	// Root -> docs (antes redirecionava para /manager, agora removido)
	app.Get("/", func(c *fiber.Ctx) error {
		return c.Redirect("/docs")
	})

	// WebSocket for real-time updates
	app.Use("/ws", func(c *fiber.Ctx) error {
		if websocket.IsWebSocketUpgrade(c) {
			return c.Next()
		}
		return fiber.ErrUpgradeRequired
	})
	app.Get("/ws", websocket.New(func(c *websocket.Conn) {
		wsHub.HandleConnection(c)
	}))

	// API routes
	api := app.Group("/api/v1")

	// Auth aplicada POR ROTA (não via Group Use).
	// Motivo: dois Groups no mesmo prefixo /instance faziam o MasterKeyAuth
	// (registrado como Use no prefixo) sombrear /instance/status e
	// /instance/qrcode, tornando-os inalcançáveis com a chave de instância.
	// Registrar a auth por rota mantém os mesmos paths sem esse vazamento.
	masterAuth := middleware.MasterKeyAuth(cfg.MasterAPIKey)
	instanceAuth := middleware.APIKeyAuth(instanceRepo)

	// Instance management (Master API Key)
	api.Post("/instance", masterAuth, instanceHandler.Create)
	api.Get("/instance/all", masterAuth, instanceHandler.ListAll)
	api.Delete("/instance/:id", masterAuth, instanceHandler.DeleteByID)
	api.Post("/instance/:id/disconnect", masterAuth, instanceHandler.DisconnectByID)
	api.Get("/instance/:id/connect", masterAuth, instanceHandler.ConnectByID)
	api.Put("/instance/:id", masterAuth, instanceHandler.UpdateByID)

	// Global stats (Master API Key)
	api.Get("/stats", masterAuth, func(c *fiber.Ctx) error {
		stats, _ := msgLogStore.GetGlobalStats(c.Context())
		return c.JSON(stats)
	})

	// Instance-scoped (Instance API Key)
	api.Get("/instance", instanceAuth, instanceHandler.Get)
	api.Put("/instance", instanceAuth, instanceHandler.Update)
	api.Get("/instance/status", instanceAuth, instanceHandler.Status)
	api.Get("/instance/qrcode", instanceAuth, instanceHandler.QRCode)

	// Migração de credenciais (Multi-Device) — usado pelo gateway WAMux.
	migrateHandler := handler.NewMigrateHandler(manager)
	api.Get("/instance/export", instanceAuth, migrateHandler.Export)
	api.Post("/instance/import", instanceAuth, migrateHandler.Import)
	// Sobe o socket de uma sessão já registrada (pós-import), sem QR. Master key.
	api.Post("/instance/:id/resume", masterAuth, migrateHandler.Resume)

	// Message routes (Instance API Key)
	messageGroup := api.Group("/message", middleware.APIKeyAuth(instanceRepo))
	messageGroup.Post("/text", messageHandler.SendText)
	messageGroup.Post("/media", messageHandler.SendMedia)
	messageGroup.Post("/poll", messageHandler.SendPoll)
	messageGroup.Post("/status", messageHandler.SendStatus)
	messageGroup.Post("/broadcast", messageHandler.Broadcast)
	messageGroup.Delete("/", messageHandler.Delete)
	messageGroup.Get("/history", messageHandler.History)
	messageGroup.Get("/stats", messageHandler.Stats)
	messageGroup.Get("/queue/:id", messageHandler.QueueStatus)

	// Profile routes (Instance API Key)
	profileGroup := api.Group("/profile", middleware.APIKeyAuth(instanceRepo))
	profileGroup.Get("/", profileHandler.Get)
	profileGroup.Put("/", profileHandler.Update)

	// Community/Group routes (Instance API Key)
	// Chat routes (Instance API Key)
	chatGroup := api.Group("/chat", middleware.APIKeyAuth(instanceRepo))
	chatGroup.Get("/", chatHandler.ListChats)
	chatGroup.Get("/:jid/messages", chatHandler.GetMessages)
	chatGroup.Post("/:jid/send", chatHandler.SendMessage)
	chatGroup.Post("/:jid/upload", chatHandler.SendMedia)
	chatGroup.Post("/:jid/read", chatHandler.MarkRead)

	// Contact routes (Instance API Key)
	api.Get("/contact/:jid", middleware.APIKeyAuth(instanceRepo), chatHandler.GetContactProfile)

	communityGroup := api.Group("/community", middleware.APIKeyAuth(instanceRepo))
	communityGroup.Get("/", groupHandler.ListCommunities)
	communityGroup.Post("/", groupHandler.CreateCommunity)
	communityGroup.Post("/sync", groupHandler.SyncCommunities)
	communityGroup.Get("/:jid/link", groupHandler.GetInviteLink)
	communityGroup.Delete("/:jid", groupHandler.DeleteCommunity)
	communityGroup.Post("/:jid/admins/promote", groupHandler.PromoteAdmins)
	communityGroup.Post("/:jid/admins/demote", groupHandler.DemoteAdmins)
	communityGroup.Put("/:jid", groupHandler.UpdateGroupInfo)
	communityGroup.Get("/:jid/members", groupHandler.GetMembers)

	// Regular group management (Instance API Key)
	groupGroup := api.Group("/group", middleware.APIKeyAuth(instanceRepo))
	groupGroup.Get("/", groupHandler.ListGroups)
	groupGroup.Post("/", groupHandler.CreateGroup)
	groupGroup.Post("/join", groupHandler.JoinGroup)
	groupGroup.Get("/:jid", groupHandler.GetGroupInfo)
	groupGroup.Post("/:jid/participants", groupHandler.UpdateParticipants)
	groupGroup.Put("/:jid/subject", groupHandler.SetGroupSubject)
	groupGroup.Put("/:jid/description", groupHandler.SetGroupDescription)
	groupGroup.Put("/:jid/setting", groupHandler.SetGroupSetting)
	groupGroup.Get("/:jid/invite", groupHandler.GetGroupInvite)
	groupGroup.Delete("/:jid/invite", groupHandler.RevokeGroupInvite)
	groupGroup.Post("/:jid/leave", groupHandler.LeaveGroup)

	// Labels (WhatsApp Business — Instance API Key)
	labelGroup := api.Group("/label", middleware.APIKeyAuth(instanceRepo))
	labelGroup.Get("/", labelHandler.List)
	labelGroup.Post("/", labelHandler.Upsert)
	labelGroup.Delete("/:id", labelHandler.Delete)
	labelGroup.Put("/:id/chat", labelHandler.SetChat)
	labelGroup.Get("/:id/chats", labelHandler.Chats)
	api.Get("/chat-labels/:jid", middleware.APIKeyAuth(instanceRepo), labelHandler.ChatLabels)

	// Graceful shutdown
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)

	go func() {
		addr := fmt.Sprintf(":%s", cfg.AppPort)
		appLogger.Info().Str("port", cfg.AppPort).Msg("Starting server")
		if err := app.Listen(addr); err != nil {
			appLogger.Fatal().Err(err).Msg("Server failed")
		}
	}()

	<-quit
	appLogger.Info().Msg("Shutting down server...")

	// Stop webhook worker
	close(webhookStop)
	close(queueStop)

	// Disconnect all WhatsApp instances
	manager.DisconnectAll()

	// Shutdown Fiber
	if err := app.Shutdown(); err != nil {
		appLogger.Error().Err(err).Msg("Error during server shutdown")
	}

	// Flush Sentry
	sentry.Flush(2 * time.Second)

	// Close database
	db.Close()

	appLogger.Info().Msg("Server stopped")
}

func errorHandler(c *fiber.Ctx, err error) error {
	code := fiber.StatusInternalServerError

	if e, ok := err.(*fiber.Error); ok {
		code = e.Code
	}

	// Silence noisy browser requests (favicon, chrome devtools)
	path := c.Path()
	if code == 404 && (path == "/favicon.ico" || strings.HasPrefix(path, "/.well-known/")) {
		return c.Status(code).SendString("")
	}

	if hub := sentryfiber.GetHubFromContext(c); hub != nil {
		hub.CaptureException(err)
	} else {
		sentry.CaptureException(err)
	}

	log.Error().Err(err).Int("status", code).Str("path", path).Msg("HTTP error")

	return c.Status(code).JSON(fiber.Map{
		"error":   "internal_error",
		"message": err.Error(),
		"status":  code,
	})
}
