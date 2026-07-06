# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Multi-tenant WhatsApp microservice in Go using [whatsmeow](https://github.com/tulir/whatsmeow). Exposes a REST API (Fiber v2) to manage multiple WhatsApp sessions (instances), send messages, and administer groups/communities. Each instance = one phone number with its own API key.

## Common Commands

```bash
# Run in development (requires PostgreSQL running)
docker compose up -d postgres
go run cmd/server/main.go

# Build binary (requires CGO for SQLite)
CGO_ENABLED=1 go build -o server cmd/server/main.go

# Run everything in Docker
docker compose up -d --build

# Check code
go vet ./...

# Access PostgreSQL
docker compose exec postgres psql -U user -d wamux
```

## Required Environment

Copy `.env.example` to `.env`. Required vars: `DATABASE_URL`, `MASTER_API_KEY`. Server runs on port 3000 by default. Set `APP_ENV=development` for pretty console logs.

## Architecture

### Dual Database Design
- **PostgreSQL**: stores instance metadata, webhook deliveries. Migrations run automatically on startup via `internal/database/database.go:RunMigrations()` using idempotent DDL.
- **SQLite** (one file per instance in `sessions/` dir): whatsmeow session storage. A custom driver in `internal/database/sqlite_driver.go` registers as `"sqlite3"` and auto-enables foreign keys.

### Core Flow: `main.go` -> Manager -> Client
- `cmd/server/main.go`: single entrypoint. Wires everything, defines all routes, embeds `manager.html` via `//go:embed`. Routes split by auth: Master API Key routes (admin CRUD) vs Instance API Key routes (per-instance operations).
- `internal/instance/manager.go`: central orchestrator. Holds a `map[string]*whatsapp.Client` in memory (mutex-protected). Creates whatsmeow clients, handles connect/disconnect/reconnect, wires event callbacks that dispatch webhooks and broadcast WebSocket events. On startup, reconnects all previously-connected instances.
- `internal/whatsapp/client.go`: wraps `whatsmeow.Client` with business logic (send text/media/poll/status, community CRUD, profile management). Has an in-memory community cache with 10-minute TTL and background sync.
- `internal/whatsapp/events.go`: maps whatsmeow events to webhook payload structs. Downloads and base64-encodes media for incoming messages.

### Authentication (two tiers)
- **Master API Key** (`X-API-Key` header or `api_key` query param): for admin routes (`/api/v1/instance` management). Single key from env.
- **Instance API Key** (`X-API-Key` header): per-instance, auto-generated on creation. Used for message/profile/community routes. Middleware resolves the instance from DB and stores it in `c.Locals("instance")`.

### Webhook System
- `internal/webhook/dispatcher.go`: persists deliveries to PostgreSQL, then attempts delivery in a goroutine. Exponential backoff retry (7 attempts max: 0s, 1s, 2s, 4s, 8s, 16s, 32s). 4xx responses immediately discard. A background worker polls for pending deliveries every 5 seconds.
- Instances opt-in to specific events via `webhook_events` JSON array: `CONNECTION_STATUS`, `MESSAGE`, `MESSAGE_STATUS`, `GROUP_MEMBERS_EDIT`.

### Real-time Updates
- WebSocket hub (`internal/ws/hub.go`) at `/ws` broadcasts all events to connected admin clients (the manager UI).

### Proxy Support
- Optional Webshare integration (`internal/proxy/webshare.go`). When `WEBSHARE_API_KEY` is set, proxies are auto-assigned to instances via round-robin SOCKS5.

### Logging
- zerolog with file rotation (lumberjack). General logs go to `logs/general/`, per-instance logs to `logs/instances/<id>/`. In development mode, adds colored console output.

### Disconnect Alert
- If an instance stays disconnected for >5 minutes, a Sentry fatal alert is raised (`instance/manager.go`). Timer is cancelled if the instance reconnects in time.

## API Route Structure

All routes under `/api/v1`:
- `/instance` (Master key): CRUD, connect, disconnect
- `/instance` (Instance key): get info, status, QR code
- `/message` (Instance key): send text, media, poll, status; delete messages
- `/profile` (Instance key): get/update profile
- `/community` (Instance key): list, create, sync, invite links, members, admin management

## Key Conventions

- Language: code is in English, docs/README in Portuguese
- All WhatsApp operations use a 15-second context timeout (`waCtx()`)
- Instance statuses: `disconnected`, `connecting`, `connected`, `logged_out`
- Phone pairing uses Chrome device identity (`waCompanionReg.DeviceProps_CHROME`)
- The `manager.html` admin panel is embedded in the binary via `//go:embed`
