---
description: The Go whatsmeow sidecar is a separate, federated service
globs:
  - services/whatsmeow/**
---

# Rule — `services/whatsmeow/**`

- This is a **Go** service (Fiber + tulir/whatsmeow), not TypeScript. **Read `services/whatsmeow/CLAUDE.md` before editing** — it is authoritative for this service.
- It is **outside the turbo pipeline**: built only by Docker (`services/whatsmeow/Dockerfile`), never by `pnpm build`. Verify with `go vet ./...` (and `CGO_ENABLED=1 go build ./...` for the SQLite driver).
- It is **federated, not managed** by the gateway: the sidecar owns its instances/queues/webhooks. The gateway's `apps/api/src/providers/whatsmeow/whatsmeow.provider.ts` auto-provisions and registers a callback. Do not replicate its state in the gateway.
- It uses a **separate Postgres database** (`WHATSMEOW_DB_NAME`, default `wamux`) plus one SQLite file per instance — never touch the gateway's `whatsapp_api` DB from here.
- If you change the sidecar's HTTP surface, flag the matching change needed in `whatsmeow.provider.ts`.
