# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

WAMux — a multi-tenant WhatsApp API gateway (like Evolution API) where the messaging engine is chosen **per instance**: `baileys`, `webjs` (whatsapp-web.js), `cloud` (official Meta Cloud API), `whatsmeow` (Go sidecar), or `zapo` (`zapo-js` — the only engine with real voice calls). One REST surface and one webhook format regardless of engine.

**Scope is deliberately narrow: connect an account, send and receive messages** (plus the account-level features WhatsApp itself exposes: groups, communities, channels, profile, calls). Bulk/mass-messaging features — campaigns, audience lists, number rotation, chip warm-up, broadcast queues — were removed on purpose and must not be reintroduced. The anti-ban layer (`throttle/`) stays because it only _limits_ sending.

## Commands

pnpm monorepo (`packageManager` pins pnpm@11.4.0, Node ≥20) orchestrated by Turborepo:

```bash
pnpm dev          # everything in watch mode (turbo)
pnpm build        # build all packages (turbo, respects ^build order)
pnpm test         # test suites (turbo) — today only @wamux/api has one
pnpm lint         # eslint across packages
pnpm type-check   # tsc --noEmit across packages
pnpm format       # prettier --write   ·   pnpm format:check to verify
pnpm clean        # rimraf dist/node_modules/.turbo per package

# Single package (workspace names: @wamux/api, @wamux/web, @wamux/shared, @wamux/config)
pnpm --filter @wamux/api dev
pnpm --filter @wamux/api test         # node:test + tsx, files in apps/api/test/*.test.ts
pnpm --filter @wamux/shared build     # rebuild shared after editing its types (see gotchas)

# Release: conventional commits (commitlint + husky) → changesets
pnpm changeset            # record a change
pnpm version-packages     # bump versions
```

**Tests** use Node's built-in runner (`node --import tsx --test`), no framework. They spin up an in-process fake WhatsApp server (`@zapo-js/fake-server`), so they need no account, phone, or network. The concurrent-schema suite is skipped unless `ZAPO_TEST_PG_URL` points at a Postgres. Coverage is still thin (capabilities + zapo credentials/migration); the end-to-end check is the Docker + curl flow in `.claude/skills/smoke-stack`.

Full stack via Docker:

```bash
cp .env.example .env
docker compose up --build
# API http://localhost:3000/api · panel http://localhost:8080 · Go sidecar docs http://localhost:8081/docs
# also brings up postgres, redis, rabbitmq (management UI :15672)
```

Running `apps/api` outside Docker needs Postgres + Redis and the env from `.env.example` (notably `WHATSMEOW_URL=http://localhost:8081` when the sidecar runs in Docker).

## Workspace layout

- `apps/api` — NestJS 10 gateway (`@wamux/api`). All the interesting logic lives here.
- `apps/web` — React 18 / Vite 5 / shadcn (Radix) admin panel (`@wamux/web`), TanStack Query + react-router; served by nginx in Docker with `/api` proxied to the gateway.
- `packages/shared` — canonical types/enums/zod schemas (`@wamux/shared`), imported by **both** api and web. Built with **tsup** (cjs+esm+dts). New provider config, event names, or DTO shapes shared with the panel go here.
- `packages/config` — eslint (flat) / tsconfig / prettier presets consumed via `@wamux/config`.
- `services/whatsmeow` — Go sidecar (Fiber + whatsmeow). **Outside the turbo pipeline**, built only by Docker. It has its own `CLAUDE.md`; read it before touching Go code.
- `patches/` — `pnpm patch` files for `baileys` and `whatsapp-web.js` (see gotchas).

## Architecture (see ARCHITECTURE.md for depth — it predates some newer modules)

**Adapter + canonical model.** `apps/api/src/providers/provider.interface.ts` (`WhatsAppProvider` + `BaseProvider`) and `provider.types.ts` define the contract and normalized model. Each engine is an adapter under `src/providers/{baileys,webjs,cloud,whatsmeow,zapo}/` that translates its library's dialect to the canonical one. **Nothing outside `src/providers/` may know about a specific engine library.** `provider.factory.ts` `new`s the adapter by the instance's `provider` field (adapters are not Nest DI providers).

**Stateful connections across workers.** Baileys/webjs/zapo hold long-lived sockets pinned to a process:

- `providers/instance-registry.service.ts` — Redis registry mapping instance → worker, ownership via TTL + heartbeat (`SET NX` prevents races).
- `instance/instance-manager.service.ts` — in-memory map of live providers for _this_ worker; wires provider events to webhooks/streams, restores active instances on boot, releases cleanly on shutdown. Session credentials persist in Postgres (`session/`), so a worker death → another worker reclaims and reconnects without re-pairing QR.

**Message flow.**

- Outbound: `messaging/` → rate limit (`throttle/rate-limiter.service.ts`, Redis token bucket per instance) with overflow to a BullMQ outbound queue (`messaging/outbound.processor.ts`); idempotency by `clientMessageId` (`throttle/idempotency.service.ts`); per-number daily caps and warm-up ramp for new accounts in `throttle/anti-ban.service.ts`.
- Inbound: socket engines emit normalized events from their adapters; HTTP engines (cloud/whatsmeow) arrive at `instance/inbound-webhook.controller.ts` → `provider.handleInboundWebhook`. Both converge on `InstanceManager`, which fans out to:
  - `webhook/` — client webhook delivery via BullMQ with retry/backoff/DLQ (`webhook.processor.ts`);
  - `events/` — "stream" transports: WebSocket gateway + RabbitMQ publisher, filtered per instance config (`event-bus.service.ts`);
  - opt-in persistence: `inbox/` (chats/contacts/messages, `DATABASE_SAVE_*` flags) and `activity-log/` (admin logs panel).
- `settings/` — global settings (device identity, global webhook) editable from the panel; the factory reads them per spawn. The engine used when `provider` is omitted on create is `DEFAULT_PROVIDER` in `@wamux/shared`.

**Auth is three-tier:** `GLOBAL_API_KEY` for admin routes (create/list/delete instances); a per-instance **master** key (generated at creation, full access); and optional **scoped** keys per instance (`api-keys/`, `instances/:id/api-keys`) limited to `ApiKeyAction`s (`read`/`send`/`control`/`setting`/`app`/`delete`), stored hashed. A key can never grant an action it doesn't hold. Guards live in `common/guards/` (`apikey` header); routes opt into action checks with `@RequireScope()`.

**whatsmeow is federated, not managed.** The Go sidecar is the source of truth for its own instances/queues/webhooks; the gateway adapter auto-provisions instances there and registers a callback webhook (`WHATSMEOW_CALLBACK_BASE`). Don't duplicate its state in the gateway. It uses a separate Postgres database (`WHATSMEOW_DB_NAME`) in the same container, and builds against the `hypermeow` fork of `go.mau.fi/whatsmeow` (a `replace` in `services/whatsmeow/go.mod`).

## Adding an engine / a feature — where things live

- **New engine (`provider`):** add to `ProviderType` in `packages/shared/src/enums.ts` → add display entry to `PROVIDERS` in `packages/shared/src/instance.ts` → new adapter dir extending `BaseProvider` → `case` in `providers/provider.factory.ts`. The create-instance DTO validates against the enum automatically. See `.claude/skills/add-engine`.
- **New endpoint/feature (vertical slice):** contract-first in `packages/shared` (type/enum/zod) → **rebuild shared** → api DTO (`class-validator`) + controller (guard) + service + provider method if it touches WhatsApp → web `apps/web/src/api.ts` hook + component. See `.claude/skills/vertical-slice`.
- **Capability-gated feature modules** (`groups/`, `newsletter/`, `communities/`, `calls/`, `labels/`, …): thin controller+service pairs mounted under `instances/:id/<feature>` (`InstanceApiKeyGuard`). The service calls **optional** provider methods (`provider.xyz?.()`) gated by a matching flag in `ProviderCapabilities` and throws `NotImplementedException` (→ **501**) uniformly when the live engine doesn't implement it — never a 500. Unsupported message _types_ (e.g. interactive buttons on an engine without a builder) return a uniform **422** from `BaseProvider` instead of faking support.
- **`GET /instances/:id/profile`** (connected account's name/picture) lives directly on `InstanceController` — a single self-describing GET, same tier as `capabilities`/`qr`/`connect`. Implemented on every non-Cloud engine; `cloud` returns 501.

## Per-engine notes

**Communities** (`capabilities.communities`): native on `baileys`, `whatsmeow` (sidecar `/community` routes) and `zapo` (a community is a group with `isParentGroup`). `webjs` (no Community API in whatsapp-web.js) and `cloud` (outside Meta's official API) stay 501.

- `deleteCommunity` only _leaves_ on baileys/whatsmeow — WhatsApp exposes no "delete for everyone" over multi-device for them. `zapo` has a real `deactivateCommunity`, so it is the only engine that actually deletes.
- The announcement subgroup is resolved **asynchronously** on baileys/whatsmeow (`communities.announcement.discovered` webhook), since subgroups aren't queryable right after creation. `zapo` gets it synchronously from `fetchSubGroups` but still emits the same webhook so the contract stays identical.
- whatsmeow lacks 1:1 sidecar routes for invite revoke and standalone group link/unlink — those throw an explicit error rather than a silent 501.
- On zapo, `fetchSubGroups` is **MEX-gated**: without an active MEX transport it throws, so `withSubGroups` degrades to a community without subgroup jids instead of failing the whole call.

**Channels / newsletter** (`capabilities.newsletter`): full CRUD on `baileys`/`whatsmeow`/`webjs`. Sending is **not** a dedicated provider method — `NewsletterService.sendMessage` reuses the generic `sendText`/`sendMedia`/`sendPoll`, since an `@newsletter` jid is just another send target. Media and polls are gated separately (`newsletterMedia`, `newsletterUnsupportedMediaTypes`, `newsletterPoll`).

- `newsletterPoll` is `false` on whatsmeow: the WhatsApp server rejects whatsmeow-framed polls to `@newsletter` with error 479 (the library special-cases newsletter _media_ but not polls). Not a WAMux bug.
- Baileys newsletter media depends on the local patch in `patches/` (an unmerged upstream PR; the npm package ships only compiled JS).
- Baileys `listNewsletters()` uses a raw, undocumented WMex query (`xwa2_newsletter_subscribed`) because the library's own method doesn't exist. If Meta rotates the GraphQL schema this query ID may rot — check here first when channel listing returns `[]`.
- Baileys channel creation fails with a raw GraphQL error on accounts not yet eligible (no client-side eligibility check exists in Baileys); WAMux only maps it to a clearer business error.

**`zapo` engine (`zapo-js`)** — third-party TS implementation of the WhatsApp Web protocol, coordinator-based (`client.message`, `client.group`, `client.newsletter`, `client.voip`, …). Structurally different from the other adapters in a few ways:

- **It does not use the gateway's `SessionStore`.** zapo has its own typed per-domain persistence (auth, signal, preKey, session, identity, senderKey, appState, …), so `providers/zapo/zapo-store.ts` points the official `@zapo-js/store-postgres` backend at the **same** Postgres with a `zapo_` table prefix, isolated by `sessionId` (= instanceId). Consequence: `sessions.clear()` doesn't reach zapo's credentials — hence the optional `clearSession?()` provider hook, called by `InstanceManagerService.clearPersistedSession` on logout/re-pair. Without it a re-pair silently reconnects the old device instead of showing a QR.
- **Real voice calls (VoIP).** `@zapo-js/voip` terminates media _inside_ the gateway (WhatsApp Opus ↔ 16 kHz mono PCM), unlike `capabilities.calling` (Cloud API), which only does signaling and delegates media to an external WebRTC endpoint. Exposed as `calls/` (`instances/:id/calls`) gated by `capabilities.voiceCalls`; playing a file is gated separately by `voiceCallAudio` because it needs **ffmpeg on PATH** (installed in `apps/api/Dockerfile`). Only audio flows (`isVideo` just flags the signaling). Live PCM streaming is not exposed over REST.
- **Media needs `@zapo-js/media-utils`.** Without a `WaMediaProcessor`, zapo makes `mimetype` mandatory and uploads without thumbnail/dimensions/waveform — which would make the same request succeed on Baileys and fail on zapo. The processor (`sharp` + `file-type` + ffmpeg/ffprobe) is wired and surfaced as `capabilities.mediaProcessing`; `ZapoProvider.mimeFor` only guesses a mimetype when the processor is **absent**.
- **Optional packages load tolerantly** (`zapo-runtime.ts`): `@zapo-js/voip` (native `@roamhq/wrtc`), `@zapo-js/media-utils` (native libvips), `@zapo-js/wam`. A failed `require` degrades the engine (capability flag `false`) — it never takes the API down.
- **`@zapo-js/wam`** replays the `w:stats` telemetry a real WhatsApp Web tab emits — footprint parity, not our own observability. On by default (`ZAPO_WAM_ENABLED`, or `wam: false` per instance); it's v0.1.x, hence the kill switch.
- **`@zapo-js/store-redis`** can host the hot, self-healing Signal domains while `auth`/`appState` stay in Postgres. **Off by default** (`ZAPO_STORE_REDIS`): WAMux's Redis serves disposable loads and may run without persistence or with an evicting `maxmemory-policy`. zapo's `cacheLayer` is deliberately **not** enabled — it assumes a single writer per `sessionId`; a lost-ownership bug would surface as a corrupted Signal ratchet instead of a visible error.
- Interactive types (buttons/list/PIX), `fetchMessages` and `labels` are `false` on zapo — no builder in the library.

**Engine migration without re-pairing.** `POST /instances/:id/provider {migrate: true}` moves a live session between **baileys ⇄ whatsmeow ⇄ zapo** in any direction via the canonical `PortableCredentials` (`exportCredentials`/`importCredentials`; capability `portableCredentials`). The path is capability-driven, not a hardcoded engine pair. Only the device **identity** travels — per-peer Signal sessions re-handshake on first contact. `providers/zapo/zapo-credentials.ts` maps zapo's `WaAuthCredentials`; both Baileys and whatsmeow store **raw 32-byte** public keys, so `toRaw32` strips a `0x05` prefix if an engine ever emits the 33-byte form. For full-fidelity transfer upstream has [`wa-store-migrate`](https://www.npmjs.com/package/wa-store-migrate) — **not wired in**: it pins `zapo-js@^0.3.0` while we run 1.6.x.

## Conventions and gotchas

- Docs, comments, and commit-facing text are in **Portuguese**; identifiers in **English**. Commits follow conventional commits (commitlint + husky); versioning via changesets. The commitlint config is `commitlint.config.mjs` — keep the `.mjs` extension (as `.js` it loads as an empty config on newer Node and rejects every commit).
- **Rebuild `@wamux/shared` after editing its types** (`pnpm --filter @wamux/shared build`): api and web consume the built `dist`, so type changes won't be seen until tsup rebuilds. `pnpm dev` runs it in `--watch`.
- `pnpm-workspace.yaml` is deliberate: `blockExoticSubdeps: false` (Baileys pulls libsignal from git), `puppeteer: false` under `allowBuilds` (Chromium comes from the Docker image via `PUPPETEER_*`, never downloaded on install), and `patchedDependencies` for `baileys` and `whatsapp-web.js`. Don't "fix" these. Both `apps/api/Dockerfile` and `apps/web/Dockerfile` must `COPY patches/` before `pnpm install` or the build fails.
- TypeORM runs with `DB_SYNCHRONIZE=true` in dev; there are no migrations yet — production intent is `DB_SYNCHRONIZE=false` + migrations.
- Multi-worker scaling assumes a unique `WORKER_ID` per replica and sticky routing in front of the gateway (not yet implemented).
- `ARCHITECTURE.md` gives the deep dive but predates some newer modules (`throttle/`, `events/`, `settings/`, `inbox/`, `api-keys/`); this file is the current source of truth for layout.
