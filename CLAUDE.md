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

No unit test runner is configured yet in either workspace.

## Architecture

This is a Bun workspace monorepo with three packages:

- **`server/`** — Express 5 API. Bun runs the TypeScript source directly (`bun --watch src/index.ts`); there is no compile step for the server, `tsc` is used for type-checking only (`noEmit: true` in `server/tsconfig.json`).
- **`client/`** — React + TypeScript SPA scaffolded with Vite.
- **`e2e/`** — Playwright e2e test harness, isolated from the dev database via a separate `helpdesk_test` Postgres database. Harness mechanics (webServer setup, `.env.test`, fixture seeding, `reuseExistingServer` caveats, rate-limit interaction) live in the `e2e-test-writer` agent (`.claude/agents/e2e-test-writer.md`) rather than here, since they only matter when actually writing/running e2e tests — read that file before touching anything under `e2e/`.

In development, the client's Vite dev server proxies `/api/*` requests to the server (`client/vite.config.ts` → `http://localhost:3001`), so the client fetches same-origin paths like `/api/health` without CORS configuration.

The current server (`server/src/index.ts`) is a minimal scaffold exposing `/api/health` and `/api/hello` — it exists to prove the client/server/proxy wiring, not as a feature implementation.

### Planning documents vs. current code

The root-level docs describe the target product and are well ahead of what's implemented:

- `project-scope.md` — product decisions and open questions for an AI-powered ticket management system (email ingestion, AI classification/routing, autonomous replies with confidence-based escalation, etc.)
- `tech-stack.md` — intended production stack, including AWS deployment (ECS Fargate, RDS Postgres+pgvector, ElastiCache, etc.) — broader than the current local dev setup
- `implementation-plan.md` — phased task breakdown for building toward that target stack

When implementing a feature, check these docs for the relevant decision or open question before inventing behavior — several tasks in `implementation-plan.md` are explicitly flagged `[blocked: open question]` pending a decision recorded in `project-scope.md`.
