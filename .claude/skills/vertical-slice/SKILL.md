---
name: vertical-slice
description: Add an endpoint or feature that spans the shared contract, the NestJS API, and the React panel. Use for most docs/ backlog items — anything that introduces a new type/event/DTO used by both the gateway and the panel.
---

# Vertical slice (shared → api → web)

WAMux keeps one contract package (`@wamux/shared`) as the single source of truth for both the API and the panel. A feature is done contract-first so the two sides never drift.

## Steps

1. **Contract — `packages/shared/src`**
   - Add the canonical piece to the right file: `enums.ts` (event/status), `instance.ts`, `messages.ts`, `events.ts`, `settings.ts`, `credentials.ts`. Add zod schemas where runtime validation is wanted.
   - Export it from `index.ts`.
2. **Rebuild shared** — `pnpm --filter @wamux/shared build`. tsup emits the `dist` that api/web consume; without this the new types are invisible. (`pnpm dev` watches it.)
3. **API — `apps/api/src/<feature>`**
   - DTO with `class-validator` (`dto/`), mirroring the shared type.
   - Controller method under the correct guard: `GlobalApiKeyGuard` (admin: instances CRUD) or `InstanceApiKeyGuard` (per-instance ops). Auth header is `apikey`.
   - Service logic. If it reaches WhatsApp, add the method to the provider contract + every adapter — never import an engine lib in the service (golden rule).
4. **Web — `apps/web/src`**
   - Hook in `api.ts` using the `req<T>` helper + TanStack Query (see `useSetEvents`, `useChangeProvider` for the pattern).
   - Component/page under `components/` or `pages/`; reuse shared constants (`PROVIDERS`, `WEBHOOK_EVENTS`, `EVENT_TRANSPORTS`) instead of re-declaring.

## Notes
- `docs/` is the prioritized backlog; **`docs/16-contrato-compartilhado.md`** consolidates contract additions — check it so multiple features don't conflict on `enums.ts`/`messages.ts`/`provider.interface.ts`.
- Docs/comments/commits in Portuguese; identifiers English; conventional commits.

## Verify
`pnpm type-check` + `pnpm lint`. No test suite — exercise runtime-visible changes with the `smoke-stack` skill. Confirm shared was rebuilt.
