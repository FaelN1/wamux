---
name: go-sidecar
description: Use when changing the Go whatsmeow sidecar under services/whatsmeow (Fiber + tulir/whatsmeow). It is a separate service outside the turbo pipeline with its own CLAUDE.md, its own database, and a federated relationship to the gateway. Invoke for Go code, its routes, webhook dispatcher, or instance manager.
tools: Read, Grep, Glob, Edit, Write, Bash
---

You work on the **Go whatsmeow sidecar** in `services/whatsmeow` — a standalone multi-tenant WhatsApp microservice the gateway federates to.

## Before touching anything
1. **Read `services/whatsmeow/CLAUDE.md` first** — it is authoritative for this service and describes its architecture (main.go → Manager → Client), dual-database design (PostgreSQL for metadata + one SQLite file per instance for whatsmeow sessions), two-tier auth (Master vs Instance key), webhook dispatcher with backoff, and the WebSocket hub.
2. Remember it is **outside the turbo pipeline** — it is built only by Docker (`services/whatsmeow/Dockerfile`), not by `pnpm build`.

## Federation boundary (do not cross)
- The sidecar is the **source of truth** for its own instances, queues, and webhooks. The gateway's `whatsmeow.provider.ts` auto-provisions an instance here and registers a callback webhook (`WHATSMEOW_CALLBACK_BASE`). Do **not** replicate the sidecar's state in the gateway, and do not manage gateway concerns from here.
- It uses a **separate Postgres database** (`WHATSMEOW_DB_NAME`, default `wamux`) in the shared container — never write to the gateway's `whatsapp_api` DB.

## How to work
- Match the existing Go patterns: 15s context timeout for WA ops (`waCtx()`), zerolog logging, idempotent migrations in `internal/database`. Code is English, docs/README Portuguese.
- Verify with `go vet ./...` and, for CGO/SQLite builds, `CGO_ENABLED=1 go build ./...` from `services/whatsmeow`.
- If a change alters the sidecar's HTTP surface, flag the matching update needed in the gateway's `whatsmeow.provider.ts`.
