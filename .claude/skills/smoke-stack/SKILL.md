---
name: smoke-stack
description: Bring up the full WAMux stack with Docker and smoke-test the core flow (create instance → connect → QR → send text) with curl. Use as the manual integration check since there is no automated test suite.
---

# Smoke-test the stack

There is no jest/unit suite in this repo. The real end-to-end check is Docker Compose + the curl flow from the README.

## Bring it up

```bash
cp .env.example .env        # set GLOBAL_API_KEY and secrets
docker compose up --build
```

Services: `gateway` (:3000/api), `web` panel (:8080), `whatsmeow` Go sidecar (:8081/docs), `postgres` (:5432), `redis` (:6379), `rabbitmq` (:5672, UI :15672). Health: `GET http://localhost:3000/api/health` (checks db + redis).

## Core flow

```bash
GLOBAL=<GLOBAL_API_KEY from .env>

# 1) create an instance, choosing the engine
curl -X POST http://localhost:3000/api/instances \
  -H "apikey: $GLOBAL" -H "Content-Type: application/json" \
  -d '{ "name": "smoke-01", "provider": "baileys" }'
# → { id, apiKey, ... }   — keep the per-instance apiKey

KEY=<apiKey>; ID=<id>

# 2) connect and read the QR (skip QR for provider "cloud")
curl -X POST http://localhost:3000/api/instances/$ID/connect -H "apikey: $KEY"
curl http://localhost:3000/api/instances/$ID/qr -H "apikey: $KEY"   # scan on the phone

# 3) send a text (idempotent with clientMessageId)
curl -X POST http://localhost:3000/api/messages/$ID/text \
  -H "apikey: $KEY" -H "Content-Type: application/json" \
  -d '{ "to": "5511999999999", "text": "smoke", "clientMessageId": "smoke-1" }'

# 4) optional: register a webhook to observe inbound
curl -X PUT http://localhost:3000/api/instances/$ID/webhook \
  -H "apikey: $KEY" -H "Content-Type: application/json" \
  -d '{ "url": "https://your-app.example/webhook" }'
```

## Per-engine notes
- `baileys` / `webjs` / `whatsmeow` need QR pairing; `cloud` needs `config.phoneNumberId` + `config.accessToken` and no QR.
- `whatsmeow` is federated to the Go sidecar — check its logs/docs at `:8081` if pairing stalls.
- Rebuild only what changed: `docker compose up --build gateway` after gateway edits.

Report health status, the instance status transitions, and whether the send returned a `SendResult` or fell to the outbound queue (throttle).
