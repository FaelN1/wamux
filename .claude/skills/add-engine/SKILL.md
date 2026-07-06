---
name: add-engine
description: Scaffold a new WhatsApp engine (provider) end-to-end in WAMux — from the canonical enum to the adapter and the factory wiring. Use when adding support for a new messaging library/engine that instances can be created with.
---

# Add a new engine (provider)

WAMux picks the engine per instance. Adding one is a fixed set of touchpoints. Do them in order; the create-instance DTO validates against the enum automatically, so the enum comes first.

## Checklist

1. **Canonical enum** — `packages/shared/src/enums.ts`: add the value to `ProviderType` (e.g. `NEWENGINE = 'newengine'`). The string is the public `provider` field in the API.
2. **Panel metadata** — `packages/shared/src/instance.ts`: add an entry to `PROVIDERS` (`{ value, label, official }`) so the create-instance UI lists it.
3. **Rebuild shared** — `pnpm --filter @wamux/shared build` (api and web import the built `dist`).
4. **Adapter** — create `apps/api/src/providers/newengine/newengine.provider.ts` extending `BaseProvider` and implementing `WhatsAppProvider` (`apps/api/src/providers/provider.interface.ts`). Read a sibling adapter first:
   - socket engine (own inbound) → model on `baileys/`;
   - HTTP-inbound / federated engine → model on `whatsmeow/` or `cloud/` and implement `handleInboundWebhook`.
   Use the base helpers (`setStatus`, `emitTyped`, `emitWebhook`) and the injected `sessionStore` for persistence. QR-less engines return `null` from `getQRCode()`.
5. **Factory** — `apps/api/src/providers/provider.factory.ts`: add a `case ProviderType.NEWENGINE: return new NewengineProvider(ctx);`. Adapters are `new`ed here, **not** registered as Nest providers, so `providers.module.ts` needs no change.
6. **Config/env (if needed)** — inject defaults in `provider.factory.ts#buildContext` and read them from `config/configuration.ts`; document new vars in `.env.example` (and `docker-compose.yml` if it runs in a container).

## Golden rule
The engine library may be imported **only** inside `apps/api/src/providers/newengine/`. Everything else deals with the canonical `WhatsAppProvider` contract.

## Verify
- `pnpm --filter @wamux/api type-check` and `pnpm lint`.
- Runtime: follow the `smoke-stack` skill — create an instance with the new `provider`, connect, (scan QR if applicable), send a text.
