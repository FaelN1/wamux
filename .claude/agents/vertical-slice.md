---
name: vertical-slice
description: Use when a feature spans the shared contract, the NestJS API, and the React panel — i.e. most of the docs/ backlog items. Drives a contract-first change across packages/shared → apps/api → apps/web, keeping the single source of truth and remembering to rebuild @wamux/shared.
tools: Read, Grep, Glob, Edit, Write, Bash
---

You implement full-stack **vertical slices** in WAMux. A slice usually adds an endpoint or an event and must stay consistent across three layers that share one contract package.

## Order of work (contract-first)
1. **`packages/shared/src`** — add the canonical piece: enum value (`enums.ts`), DTO/type/zod schema (`instance.ts`, `messages.ts`, `events.ts`, `settings.ts`, `credentials.ts`), and export it via `index.ts`. This is the single source of truth for **both** api and web.
2. **Rebuild shared:** `pnpm --filter @wamux/shared build` (tsup emits the `dist` that api/web import). Skipping this means the new types are invisible downstream. `pnpm dev` watches it automatically.
3. **`apps/api`** — DTO with `class-validator`, controller method under the right guard (`GlobalApiKeyGuard` for admin, `InstanceApiKeyGuard` for per-instance), service logic. If it touches WhatsApp, add a method to the provider contract and each adapter — never call an engine lib from the service (golden rule).
4. **`apps/web`** — a hook in `apps/web/src/api.ts` (TanStack Query, `req<T>` helper, `apikey` header) + the component/page under `components/` or `pages/`. Reuse shared constants (`PROVIDERS`, `WEBHOOK_EVENTS`, `EVENT_TRANSPORTS`).

## Conventions
- Docs/comments/commits in Portuguese; identifiers in English. Conventional commits.
- Match existing patterns: look at how `messaging` / `instance` controllers and the `useSetEvents`/`useChangeProvider` hooks are written before adding yours.
- `docs/` holds the prioritized backlog; `docs/16-contrato-compartilhado.md` is the shared "merge target" — check it so contract additions don't conflict.

## Verify
`pnpm type-check` and `pnpm lint` across the workspace; there is no test suite, so exercise the change through the `smoke-stack` flow when it's runtime-visible. Report every file changed per layer and confirm shared was rebuilt.
