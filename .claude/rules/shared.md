---
description: Rebuild the shared package after editing its types
globs:
  - packages/shared/**
---

# Rule — `packages/shared/**`

- `@wamux/shared` is the single source of truth for both `apps/api` and `apps/web`. Both import its **built `dist`** (tsup, cjs+esm+dts), not the source.
- After editing anything under `packages/shared/src`, **rebuild**: `pnpm --filter @wamux/shared build`. Otherwise the new/changed types are invisible to api and web and you'll chase phantom type errors. `pnpm dev` runs tsup in `--watch`, so it's automatic there.
- Export every new symbol from `packages/shared/src/index.ts`.
- Keep API and panel constants here (`PROVIDERS`, `WEBHOOK_EVENTS`, `EVENT_TRANSPORTS`, zod schemas) — don't duplicate them in api or web.
