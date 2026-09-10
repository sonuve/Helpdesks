#!/bin/sh
# playwright.config.ts's webServer entries use reuseExistingServer: true
# locally, which means if anything else is already listening on :3001 or
# :5173 — most commonly `bun run dev` / `bun run dev:server` /
# `bun run dev:client` left running from normal local development —
# Playwright silently reuses it instead of starting its own test-env
# server (server/.env.test, the helpdesk_test database). That server is
# running against the *dev* database, which doesn't have the e2e fixture
# accounts seeded into it, so tests/auth.setup.ts fails signing in as
# them with "invalid email or password" and the rest of the suite never
# runs. See the NOTE comment at the top of playwright.config.ts.
#
# Run before every `playwright test` invocation (wired into
# e2e/package.json's "test"/"test:ui" scripts) so this can't bite anymore:
# free :3001/:5173 first, unconditionally, so Playwright always starts its
# own test-env server pair.
for port in 3001 5173; do
  pids=$(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null)
  if [ -n "$pids" ]; then
    echo "[free-dev-ports] stopping process(es) on :$port ($pids) before running e2e tests"
    kill $pids 2>/dev/null
  fi
done

# Give the OS a moment to actually release the ports before webServer
# tries to bind them.
sleep 1
