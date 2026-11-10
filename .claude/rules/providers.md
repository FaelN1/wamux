---
description: Golden rule and registration checklist for engine adapters
globs:
  - apps/api/src/providers/**
---

# Rule — `apps/api/src/providers/**`

- **Golden rule:** engine libraries (baileys, whatsapp-web.js, the Meta HTTP client, the whatsmeow sidecar client) may be imported **only** inside this directory. Nothing under `instance/`, `messaging/`, `webhook/`, `events/`, or `apps/web` may know a specific engine. New concepts become canonical types in `provider.types.ts` / `packages/shared` first, then a per-adapter translation.
- Every adapter **extends `BaseProvider`** and satisfies `WhatsAppProvider` (`provider.interface.ts`). Emit through the typed helpers (`setStatus`, `emitTyped`, `emitWebhook`) — never call webhooks/queues from an adapter.
- Respect lifecycle semantics: `destroy()` frees resources without logging out (redeploy-safe); `logout()` drops credentials; `initialize()` is idempotent and restores via `sessionStore`.
- Registering an engine touches exactly: `ProviderType` (`packages/shared/src/enums.ts`) → `PROVIDERS` (`packages/shared/src/instance.ts`) → adapter dir → `case` in `provider.factory.ts`. Adapters are `new`ed by the factory, **not** Nest DI providers — don't add them to `providers.module.ts`.
