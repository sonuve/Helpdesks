# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Documentation lookups

Use the `context7` MCP tool to fetch up-to-date documentation for this project's dependencies (Express, React, Vite, Bun, TypeScript) before relying on prior knowledge of their APIs — resolve the library ID first, then fetch docs scoped to the specific API in question.

## Commands

All commands run from the repo root via Bun workspaces (`client`, `server`, `core`, `e2e`).

- `bun install` — install/link dependencies for all workspaces
- `bun run dev` — run client and server dev servers together (`bun run --filter '*' dev`)
- `bun run dev:client` — client only (Vite dev server, default port 5173, falls back to next free port)
- `bun run dev:server` — server only (`bun --watch server/src/index.ts`, port 3001 by default, override with `PORT`)
- `bun run build` — production build of the client (`tsc -b && vite build` in `client/`)
- `bun run typecheck` — typecheck `core` and the server (`tsc --noEmit` in each); the client typechecks as part of its own `build`
- `cd client && bun run lint` — lint the client with oxlint
- `bun run test:e2e` — run Playwright e2e tests (`e2e/`). See the `e2e-test-writer` agent (`.claude/agents/e2e-test-writer.md`) for harness mechanics (separate test database, fixture seeding, rate-limit interaction).
- `bun run test` — run client component tests once (`vitest run` in `client/`). `cd client && bun run test:watch` reruns on change; `cd client && bun run test:ui` opens Vitest's interactive dashboard. See "Component testing" below before writing new specs.

No unit test runner is configured for the server workspace yet.

## Architecture

This is a Bun workspace monorepo with four packages:

- **`server/`** — Express 5 API. Bun runs the TypeScript source directly (`bun --watch src/index.ts`); there is no compile step for the server, `tsc` is used for type-checking only (`noEmit: true` in `server/tsconfig.json`).
- **`client/`** — React + TypeScript SPA scaffolded with Vite. Data fetching uses `axios` (not the raw `fetch` API) as the HTTP client, wrapped in TanStack Query (`@tanstack/react-query`) `useQuery`/`useMutation` hooks rather than manual `useEffect`/`useState` fetch logic — see `client/src/main.tsx` for the `QueryClientProvider` setup and `client/src/pages/UsersTable.tsx` for the pattern to follow.
- **`core/`** — code shared between `client` and `server`, currently `zod` schemas (see "Data validation" below). Consumed as the plain workspace package `core` (`import { ... } from "core"`), not a `@scope/` name. No compile step, same as `server/`: `package.json`'s `main`/`exports` point straight at `src/index.ts`, and because it's Bun-workspace-linked (a real symlink into `node_modules`, not a copied/published package), both Bun (server) and Vite (client) resolve and transform that TypeScript source directly. `bun run typecheck` covers it via its own `tsc --noEmit`.
- **`e2e/`** — Playwright e2e test harness, isolated from the dev database via a separate `helpdesk_test` Postgres database. Harness mechanics (webServer setup, `.env.test`, fixture seeding, `reuseExistingServer` caveats, rate-limit interaction) live in the `e2e-test-writer` agent (`.claude/agents/e2e-test-writer.md`) rather than here, since they only matter when actually writing/running e2e tests — read that file before touching anything under `e2e/`.

**When writing or updating e2e tests, delegate to the `e2e-test-writer` subagent** (`Agent` tool, `subagent_type: "e2e-test-writer"`) instead of writing Playwright specs directly — it knows the fixture-seeding requirement (the test DB starts empty and public signup is disabled), the shared sign-in rate-limit budget across a run, and the port-reuse footgun with an already-running dev server. Writing specs inline without that context risks flaky or dev-data-corrupting tests. This applies whether the request is to add coverage for a new flow or to update existing specs under `e2e/tests/`.

In development, the client's Vite dev server proxies `/api/*` requests to the server (`client/vite.config.ts` → `http://localhost:3001`), so the client fetches same-origin paths like `/api/health` without CORS configuration.

`server/src/index.ts` wires up the app (CORS, trust proxy, better-auth handoff, session middleware) and exposes `/api/health` and `/api/hello`, which exist to prove the client/server/proxy wiring rather than as feature implementations. Feature endpoints live in their own router modules under `server/src/routes/` (e.g. `users.ts` for `/api/me`, `/api/users`), mounted onto `app` in `index.ts`.

### Data validation

Use `zod` for validating external input — request bodies on the server, form input on the client — rather than hand-rolled `typeof`/regex checks.

**Any schema that validates the same input shape on both sides of the API boundary belongs in `core/`, not duplicated in `client/` and `server/`.** Add it under `core/src/schemas/` (one file per resource, e.g. `user.ts`), export it (plus its inferred `z.infer` type) from `core/src/index.ts`, and import it by name from the `core` package in both workspaces — see `createUserSchema/CreateUserInput` in `core/src/schemas/user.ts` for the pattern. A schema that's genuinely local to one side (e.g. a server-only internal query-param schema with no client form behind it) can still live next to its own route/component instead.

- **Server**: validate with `.safeParse(req.body)` using the imported schema, returning the first issue's message as a `400`. See the `POST /api/users` handler in `server/src/routes/users.ts`, which imports `createUserSchema` from `core`.
- **Client**: pair the imported schema with `react-hook-form` via `@hookform/resolvers/zod`'s `zodResolver`, rather than validating in the submit handler by hand — `register()` each field, read errors off `formState.errors`, and type the form with the schema's inferred type (e.g. `CreateUserInput`) instead of redeclaring it. `client/src/pages/UserForm.tsx` is the reference example; `LoginPage.tsx` predates this convention and still defines its schema locally.

`UserForm.tsx` also illustrates the form/chrome split to follow for anything presented in a modal: the form component owns `useForm`, the `zod` schema, and the submit mutation, and reports out via an `onSuccess` callback prop rather than reaching into the dialog's open state directly. `CreateUserDialog.tsx` is just the `Dialog` trigger/header wrapping it, passing `onSuccess={() => setOpen(false)}` — it relies on Radix's `Dialog.Content` unmounting on close (no `forceMount`) to discard the form's local state, rather than an explicit `reset()`. This keeps the form reusable outside a dialog and independently testable (`UserForm.test.tsx` covers validation/submission; `CreateUserDialog.test.tsx` only covers the open/close wiring).

The same split applies one level up, between a route-level page and the data-fetching component(s) it composes: `UsersPage.tsx` is layout only (heading, `CreateUserDialog`, `UsersTable`), while `UsersTable.tsx` owns the `useQuery` call and all of its loading/error/empty/populated states. Prefer this over folding fetching and every state branch directly into the page component — it keeps the page trivial to read and lets the data component be tested (and reused) independently of page layout.

### Error handling

Express 5 automatically forwards a rejected promise from an `async` route handler to the error-handling middleware — unlike Express 4, you don't need to wrap the handler body in `try/catch` (or a `catchAsync`-style helper) just to keep the process from crashing on an unhandled rejection. The handlers in `server/src/routes/users.ts` (`POST /api/users`, `GET /api/users`) let Prisma/zod errors propagate this way.

Only reach for `try/catch` when you need to turn a specific failure into a specific response, rather than the default error handling. `GET /api/health` is the example: it catches so it can report `503 { status: "error", database: "unreachable" }` instead of a generic 500, since the probe's whole purpose is distinguishing "DB unreachable" from "server down."

### Rate limiting

Two layers, both IP-keyed:

- **`/api/auth/*`** (sign-in, sign-up, session, etc.): better-auth's built-in limiter (`server/src/lib/auth.ts`), forced on in all environments (`enabled: true`) rather than its "production only" default, so dev/test behavior matches prod. Sign-in/sign-up/password-change get a stricter built-in 3-requests/10s rule automatically; everything else under `/api/auth` gets the configured 100/60s default. Counters are stored in Postgres (`rate_limit` table, added by the `add_rate_limit_table` migration) rather than in-memory, so counts stay correct across multiple server instances — no Redis dependency needed just for this.
- **Everything else** (`/api/hello`, `/api/me`, `/api/users`): `express-rate-limit`, 100 requests/60s, in-memory. The limiter (`apiLimiter`) is defined once in `server/src/middleware/rate-limit.ts` and applied per-route in `server/src/index.ts` (`/api/hello`) and `server/src/routes/users.ts` (`/api/me`, `/api/users`). `/api/health` is deliberately excluded — it's an infra health probe (ALB target group) and must not be throttled.

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

`client/src/pages/UsersTable.test.tsx` is the reference example for all of the above (loading-skeleton state, populated table, empty state, error state).

### Planning documents vs. current code

The root-level docs describe the target product and are well ahead of what's implemented:

- `project-scope.md` — product decisions and open questions for an AI-powered ticket management system (email ingestion, AI classification/routing, autonomous replies with confidence-based escalation, etc.)
- `tech-stack.md` — intended production stack, including AWS deployment (ECS Fargate, RDS Postgres+pgvector, ElastiCache, etc.) — broader than the current local dev setup
- `implementation-plan.md` — phased task breakdown for building toward that target stack

When implementing a feature, check these docs for the relevant decision or open question before inventing behavior — several tasks in `implementation-plan.md` are explicitly flagged `[blocked: open question]` pending a decision recorded in `project-scope.md`.
