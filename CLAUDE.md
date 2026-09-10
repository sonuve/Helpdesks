# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Documentation lookups

Use the `context7` MCP tool to fetch up-to-date documentation for this project's dependencies (Express, React, Vite, Bun, TypeScript) before relying on prior knowledge of their APIs — resolve the library ID first, then fetch docs scoped to the specific API in question.

## Commands

All commands run from the repo root via Bun workspaces (`client`, `server`, `e2e`).

- `bun install` — install/link dependencies for all workspaces
- `bun run dev` — run client and server dev servers together (`bun run --filter '*' dev`)
- `bun run dev:client` — client only (Vite dev server, default port 5173, falls back to next free port)
- `bun run dev:server` — server only (`bun --watch server/src/index.ts`, port 3001 by default, override with `PORT`)
- `bun run build` — production build of the client (`tsc -b && vite build` in `client/`)
- `bun run typecheck` — typecheck the server (`tsc --noEmit` in `server/`); the client typechecks as part of its own `build`
- `cd client && bun run lint` — lint the client with oxlint
- `bun run test:e2e` — run Playwright e2e tests (`e2e/`). See the `e2e-test-writer` agent (`.claude/agents/e2e-test-writer.md`) for harness mechanics (separate test database, fixture seeding, rate-limit interaction).
- `bun run test` — run client component tests once (`vitest run` in `client/`). `cd client && bun run test:watch` reruns on change; `cd client && bun run test:ui` opens Vitest's interactive dashboard. See "Component testing" below before writing new specs.

No unit test runner is configured for the server workspace yet.

## Architecture

This is a Bun workspace monorepo with three packages:

- **`server/`** — Express 5 API. Bun runs the TypeScript source directly (`bun --watch src/index.ts`); there is no compile step for the server, `tsc` is used for type-checking only (`noEmit: true` in `server/tsconfig.json`).
- **`client/`** — React + TypeScript SPA scaffolded with Vite. Data fetching uses `axios` (not the raw `fetch` API) as the HTTP client, wrapped in TanStack Query (`@tanstack/react-query`) `useQuery`/`useMutation` hooks rather than manual `useEffect`/`useState` fetch logic — see `client/src/main.tsx` for the `QueryClientProvider` setup and `client/src/pages/UsersPage.tsx` for the pattern to follow.
- **`e2e/`** — Playwright e2e test harness, isolated from the dev database via a separate `helpdesk_test` Postgres database. Harness mechanics (webServer setup, `.env.test`, fixture seeding, `reuseExistingServer` caveats, rate-limit interaction) live in the `e2e-test-writer` agent (`.claude/agents/e2e-test-writer.md`) rather than here, since they only matter when actually writing/running e2e tests — read that file before touching anything under `e2e/`.

**When writing or updating e2e tests, delegate to the `e2e-test-writer` subagent** (`Agent` tool, `subagent_type: "e2e-test-writer"`) instead of writing Playwright specs directly — it knows the fixture-seeding requirement (the test DB starts empty and public signup is disabled), the shared sign-in rate-limit budget across a run, and the port-reuse footgun with an already-running dev server. Writing specs inline without that context risks flaky or dev-data-corrupting tests. This applies whether the request is to add coverage for a new flow or to update existing specs under `e2e/tests/`.

In development, the client's Vite dev server proxies `/api/*` requests to the server (`client/vite.config.ts` → `http://localhost:3001`), so the client fetches same-origin paths like `/api/health` without CORS configuration.

The current server (`server/src/index.ts`) is a minimal scaffold exposing `/api/health` and `/api/hello` — it exists to prove the client/server/proxy wiring, not as a feature implementation.

### Rate limiting

Two layers, both IP-keyed:

- **`/api/auth/*`** (sign-in, sign-up, session, etc.): better-auth's built-in limiter (`server/src/lib/auth.ts`), forced on in all environments (`enabled: true`) rather than its "production only" default, so dev/test behavior matches prod. Sign-in/sign-up/password-change get a stricter built-in 3-requests/10s rule automatically; everything else under `/api/auth` gets the configured 100/60s default. Counters are stored in Postgres (`rate_limit` table, added by the `add_rate_limit_table` migration) rather than in-memory, so counts stay correct across multiple server instances — no Redis dependency needed just for this.
- **Everything else** (`/api/hello`, `/api/me`): `express-rate-limit` (`server/src/index.ts`), 100 requests/60s, in-memory. `/api/health` is deliberately excluded — it's an infra health probe (ALB target group) and must not be throttled.

Both need the real client IP to key correctly, which only works if two things are set per environment:

- **`NODE_ENV`** — must be `development`/`test`/`production` (set in `server/.env`, `server/.env.test`, and the production task definition respectively). Without it, better-auth's own IP resolution can't identify local requests and every client collapses into one shared bucket per path — a real correctness bug, not just a missing nicety.
- **`TRUSTED_PROXY_CIDRS`** — comma-separated CIDR list of trusted proxies, read by both `app.set("trust proxy", ...)` in `index.ts` and better-auth's `advanced.ipAddress.trustedProxies` in `auth.ts`. Empty in dev/test (no proxy in front locally). In production, set it to the VPC CIDR the ALB forwards from (see `tech-stack.md`'s deployment section) — without it, `X-Forwarded-For` isn't trusted and every request behind the ALB looks like it comes from the same place.

### Component testing

Client component tests use Vitest + React Testing Library, jsdom environment. Config lives in `client/vite.config.ts`'s `test` block (`/// <reference types="vitest/config" />` at the top of that file makes the `test` key available on `defineConfig` from `vite`); global setup is `client/src/test/setup.ts` (registers `@testing-library/jest-dom/vitest` matchers and calls RTL's `cleanup()` in `afterEach` — required because the config doesn't set `globals: true`, so every test file imports `describe`/`it`/`expect`/etc. from `vitest` explicitly rather than relying on ambient globals).

When writing a new spec:

- **Location & naming**: colocate as `Component.test.tsx` next to the component it tests (e.g. `client/src/pages/UsersPage.tsx` → `client/src/pages/UsersPage.test.tsx`), not in a separate `__tests__` tree.
- **Data fetching**: don't hit the real API. `vi.mock("axios")` at the top of the file, then `vi.mocked(axios, true)` to get a typed mock and set per-test behavior with `mockResolvedValue`/`mockRejectedValue`/`mockReturnValue` (reset in `beforeEach` so tests don't leak mock state into each other).
- **TanStack Query components**: any component using `useQuery`/`useMutation` needs a `QueryClientProvider` ancestor in the test render — use the `renderWithQuery` helper from `client/src/test/render-with-query.tsx` instead of hand-rolling a `QueryClient` per test file. It wires up a fresh client per render with `retry: false` (so a mocked rejection surfaces immediately instead of retrying and timing out the test).
- **Async assertions**: query pending/loaded/error states with RTL's `findBy*`/`findAllBy*` (they wait), not `getBy*` immediately after a fetch-triggering render.
- **Ambiguous text matches**: shadcn components often duplicate visible text (e.g. a table column header and a badge in that column can both say "Verified") — disambiguate with `getByText(text, { selector: "span" })` or scope with `within(row)` rather than reaching for `getAllByText` and indexing blindly.

`client/src/pages/UsersPage.test.tsx` is the reference example for all of the above (loading-skeleton state, populated table, empty state, error state).

### Planning documents vs. current code

The root-level docs describe the target product and are well ahead of what's implemented:

- `project-scope.md` — product decisions and open questions for an AI-powered ticket management system (email ingestion, AI classification/routing, autonomous replies with confidence-based escalation, etc.)
- `tech-stack.md` — intended production stack, including AWS deployment (ECS Fargate, RDS Postgres+pgvector, ElastiCache, etc.) — broader than the current local dev setup
- `implementation-plan.md` — phased task breakdown for building toward that target stack

When implementing a feature, check these docs for the relevant decision or open question before inventing behavior — several tasks in `implementation-plan.md` are explicitly flagged `[blocked: open question]` pending a decision recorded in `project-scope.md`.
