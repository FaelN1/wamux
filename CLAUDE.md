# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

WAMux — a multi-tenant WhatsApp API gateway (like Evolution API) where the messaging engine is chosen **per instance**: `baileys`, `webjs` (whatsapp-web.js), `cloud` (official Meta Cloud API), or `whatsmeow` (Go sidecar). One REST surface and one webhook format regardless of engine.

## Commands

pnpm monorepo (pnpm ≥10 / `packageManager` pins pnpm@11.4.0, Node ≥20) orchestrated by Turborepo:

```bash
pnpm dev          # everything in watch mode (turbo)
pnpm build        # build all packages (turbo, respects ^build order)
pnpm lint         # eslint across packages
pnpm type-check   # tsc --noEmit across packages
pnpm format       # prettier --write   ·   pnpm format:check to verify
pnpm clean        # rimraf dist/node_modules/.turbo per package

# Single package (workspace names: @wamux/api, @wamux/web, @wamux/shared, @wamux/config)
pnpm --filter @wamux/api dev
pnpm --filter @wamux/shared build     # rebuild shared after editing its types (see gotchas)

# Release: conventional commits (commitlint + husky) → changesets
pnpm changeset            # record a change
pnpm version-packages     # bump versions
```

**No test suite exists yet.** `@wamux/api` declares `jest` but there is no config nor `test/` dir — and its lint script is `eslint src test`, so lint currently points at a missing `test/` path. The real smoke test is the Docker + curl flow (see `.claude/skills/smoke-stack`).

Full stack via Docker:

```bash
cp .env.example .env
docker compose up --build
# API http://localhost:3000/api · panel http://localhost:8080 · Go sidecar docs http://localhost:8081/docs
# also brings up postgres, redis, rabbitmq (management UI :15672)
```

Running `apps/api` outside Docker needs Postgres + Redis and the env from `.env.example` (notably `WHATSMEOW_URL=http://localhost:8081` when the sidecar runs in Docker). Note the compose file also injects `RABBITMQ_URI` and `PUBLIC_BASE_URL`, which are **not** in `.env.example` — add them if running the gateway standalone.

## Workspace layout

- `apps/api` — NestJS 10 gateway (`@wamux/api`). All the interesting logic lives here.
- `apps/web` — React 18 / Vite 5 / shadcn (Radix) admin panel (`@wamux/web`), TanStack Query + react-router; served by nginx in Docker with `/api` proxied to the gateway.
- `packages/shared` — canonical types/enums/zod schemas (`@wamux/shared`), imported by **both** api and web. Built with **tsup** (cjs+esm+dts). New provider config, event names, or DTO shapes shared with the panel go here.
- `packages/config` — eslint (flat) / tsconfig / prettier presets consumed via `@wamux/config`.
- `services/whatsmeow` — Go sidecar (Fiber + whatsmeow). **Outside the turbo pipeline**, built only by Docker. It has its own `CLAUDE.md`; read it before touching Go code.

## Architecture (see ARCHITECTURE.md for depth — note it references older `src/` paths)

**Adapter + canonical model.** `apps/api/src/providers/provider.interface.ts` (`WhatsAppProvider` + `BaseProvider`) and `provider.types.ts` define the contract and normalized model. Each engine is an adapter under `src/providers/{baileys,webjs,cloud,whatsmeow}/` that translates its library's dialect to the canonical one. **Nothing outside `src/providers/` may know about a specific engine library.** `provider.factory.ts` `new`s the adapter by the instance's `provider` field (adapters are not Nest DI providers).

**Stateful connections across workers.** Baileys/webjs hold long-lived sockets pinned to a process:

- `providers/instance-registry.service.ts` — Redis registry mapping instance → worker, ownership via TTL + heartbeat (`SET NX` prevents races).
- `instance/instance-manager.service.ts` — in-memory map of live providers for _this_ worker; wires provider events to webhooks/streams, restores active instances on boot, releases cleanly on shutdown. Session credentials persist in Postgres (`session/`), so a worker death → another worker reclaims and reconnects without re-pairing QR.

**Message flow.**

- Outbound: `messaging/` → rate limit (`throttle/rate-limiter.service.ts`, Redis token bucket per instance) with overflow to a BullMQ outbound queue (`messaging/outbound.processor.ts`); idempotency by `clientMessageId` (`throttle/idempotency.service.ts`).
- Inbound: socket engines emit normalized events from their adapters; HTTP engines (cloud/whatsmeow) arrive at `instance/inbound-webhook.controller.ts` → `provider.handleInboundWebhook`. Both converge on `InstanceManager`, which fans out to:
  - `webhook/` — client webhook delivery via BullMQ with retry/backoff/DLQ (`webhook.processor.ts`);
  - `events/` — "stream" transports: WebSocket gateway + RabbitMQ publisher, filtered per instance config (`event-bus.service.ts`).
- `settings/` — global settings (device identity, global webhook) editable from the panel; the factory reads them per spawn.

**Auth is two-tier:** `GLOBAL_API_KEY` for admin routes (create/list/delete instances); a per-instance API key (generated at creation) for everything else. Guards live in `common/guards/` (`apikey` header).

**whatsmeow is federated, not managed.** The Go sidecar is the source of truth for its own instances/queues/webhooks; the gateway adapter auto-provisions instances there and registers a callback webhook (`WHATSMEOW_CALLBACK_BASE`). Don't duplicate its state in the gateway. It uses a separate Postgres database (`WHATSMEOW_DB_NAME`) in the same container.

## Adding an engine / a feature — where things live

- **New engine (`provider`):** add to `ProviderType` in `packages/shared/src/enums.ts` → add display entry to `PROVIDERS` in `packages/shared/src/instance.ts` → new adapter dir extending `BaseProvider` → `case` in `providers/provider.factory.ts`. The create-instance DTO validates against the enum automatically. See `.claude/skills/add-engine`.
- **New endpoint/feature (vertical slice):** contract-first in `packages/shared` (type/enum/zod) → **rebuild shared** → api DTO (`class-validator`) + controller (guard) + service + provider method if it touches WhatsApp → web `apps/web/src/api.ts` hook + component. See `.claude/skills/vertical-slice`. `docs/` is a prioritized backlog of such slices (start at `docs/16-contrato-compartilhado.md`, the "merge target").
- **Capability-gated feature modules** (`groups/`, `newsletter/`, `communities/`): thin controller+service pairs mounted under `instances/:id/<feature>` (`InstanceApiKeyGuard`). The service calls **optional** provider methods (`provider.xyz?.()`) gated by a matching flag in `ProviderCapabilities` (`capabilities.groups`/`.newsletter`/`.communities`) and throws `NotImplementedException` (→ 501) uniformly when the live engine doesn't implement it — never a 500. `baileys` and `whatsmeow` implement `communities` (native support — Baileys via socket, whatsmeow via the Go sidecar's own `/community` CRUD); `webjs` stays 501 on purpose (whatsapp-web.js has no Community API — a maintainer attempt was abandoned) and `cloud` too (out of Meta's official API scope). See known per-engine limitations in `apps/api/src/providers/{baileys,whatsmeow}/*.provider.ts` (search "comunidades") and the full contract/gap list in `docs/community-contract-handoff.md`: `deleteCommunity` only _leaves_ on both engines (WhatsApp exposes no "delete for everyone" over multi-device), the announcement-group subgroup is resolved **asynchronously** (`communities.announcement.discovered` webhook) since the server needs a moment after creation before subgroups are queryable, and whatsmeow specifically lacks 1:1 sidecar routes for a few operations (invite revoke, standalone group link/unlink) — those throw an explicit error rather than a silent 501.
- **`newsletter/`** (channels) has full CRUD parity across `baileys`/`whatsmeow`/`webjs` (`capabilities.newsletter`) — whatsmeow's sidecar gained a `/newsletter` route this cycle, using `go.mau.fi/whatsmeow`'s native newsletter API. Sending is **not** a dedicated provider method — `NewsletterService.sendMessage` reuses the generic (mandatory) `sendText`/`sendMedia`/`sendPoll`, since every engine treats an `@newsletter` jid like any other send target at the protocol level. Media and poll support vary per engine/type and are gated by separate flags (`capabilities.newsletterMedia`, `.newsletterUnsupportedMediaTypes`, `.newsletterPoll`) rather than folded into `newsletter` itself. **Media parity is closed on all 3 engines; poll parity is closed on baileys/webjs only** — whatsmeow's poll-to-newsletter was tried live against a real channel (`POST /message/poll` — `BuildPollCreation`, which turned out to already exist in the sidecar, only the TS adapter wiring was missing) and the WhatsApp server rejects it outright with `server returned error 479`, reproducibly, while the identical operation succeeds on Baileys against the same channel/account — a confirmed real gap in how `go.mau.fi/whatsmeow` frames polls for `@newsletter` (media already special-cases newsletters via `UploadNewsletter`+`MediaHandle`; poll doesn't), not a WAMux bug — `capabilities.newsletterPoll` is `false` for whatsmeow. On Baileys specifically, text/image/video/audio/document/poll sends were all confirmed live end-to-end against a real channel (not just capability-flag-flipped), and the same battery was repeated on the _same_ real session after live-migrating it from baileys to whatsmeow via `POST /instances/:id/provider {migrate: true}` (portable MD credentials, no re-pairing) — confirming that migration path works for a real connected account. Baileys media required a **local patch** (`pnpm patch`, see `pnpm-workspace.yaml`'s `patchedDependencies` and `patches/`) applying an unmerged-but-community-verified upstream PR, since the npm package only ships compiled JS, not the TS source the PR diffs against — both `apps/api/Dockerfile` and `apps/web/Dockerfile` must `COPY patches/` before `pnpm install` or the build fails. A separate real bug was found and fixed in the same round: Baileys' `listNewsletters()` called a method (`getSubscribedNewsletters`) that never existed in the library, silently returning `[]` even for accounts with real owned channels — fixed via an undocumented raw WMex query (`xwa2_newsletter_subscribed`, sourced from a library contributor's GitHub comment, not an official API — the query ID may rot if Meta rotates the GraphQL schema); the field mapper (`toNewsletter`) was also reading the wrong (flat) response shape instead of the real nested one, affecting `GET /:jid` too. The one remaining **structural, unfixable-in-WAMux** gap is Baileys channel creation, which fails with a raw GraphQL error on accounts not yet eligible (no client-side eligibility check exists in Baileys, unlike webjs/whatsmeow) — mitigated with a clearer business-error message only, no functional workaround exists. See the full per-type matrix, patch details, the listing-bug root cause, verified-from-source citations, and what remains unvalidated live (whatsmeow/webjs need device pairing) in `docs/newsletter-contract-handoff.md`.
- **`GET /instances/:id/profile`** (name/`profilePicUrl` of the connected account) follows the same capability-gated pattern (`capabilities.profile`) but lives directly on `InstanceController` rather than its own feature module — it's a single self-describing GET with no sub-resources, same tier as `capabilities`/`qr`/`connect` which already live there. Implemented on all three non-Cloud engines: `baileys` reads `sock.user` (name/verifiedName/notify fallback chain) + `sock.profilePictureUrl()`; `whatsmeow` is a pass-through to the sidecar's pre-existing `GET /profile`; `webjs` reads `client.info.pushname` + `client.getProfilePicUrl()`. `cloud` (Meta) stays 501 — not exposed by the official API in this gateway's current scope.

## Conventions and gotchas

- Docs, comments, and commit-facing text are in **Portuguese**; identifiers in **English**. Commits follow conventional commits (commitlint + husky); versioning via changesets.
- **Rebuild `@wamux/shared` after editing its types** (`pnpm --filter @wamux/shared build`): api and web consume the built `dist`, so type changes won't be seen until tsup rebuilds. `pnpm dev` runs it in `--watch`.
- `pnpm-workspace.yaml` is deliberate: `blockExoticSubdeps: false` (Baileys pulls libsignal from git) and `puppeteer: false` under `allowBuilds` (Chromium comes from the Docker image via `PUPPETEER_*`, never downloaded on install). Don't "fix" these.
- TypeORM runs with `DB_SYNCHRONIZE=true` in dev; there are no migrations yet — production intent is `DB_SYNCHRONIZE=false` + migrations.
- Engine switch without re-pairing relies on portable MD credentials (`exportCredentials`/`importCredentials` in the provider contract) — only some engines support it (`portableCredentials`).
- Multi-worker scaling assumes a unique `WORKER_ID` per replica and sticky routing in front of the gateway (not yet implemented).
- `ARCHITECTURE.md` gives the deep dive but predates some newer modules (`throttle/`, `events/`, `settings/`); this file is the current source of truth for layout.
