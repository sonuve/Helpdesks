# Single-service production image: builds the client SPA and runs the
# Express server, which serves both (see server/src/app.ts's production
# static-file block) — see the "Deploy topology" decision in the
# deployment writeup for why this is one service instead of two.
FROM oven/bun:1

WORKDIR /app

# Install only the workspaces this image needs. e2e/'s Playwright
# devDependency is dev/test-only and has no place in a production image.
COPY package.json bun.lock ./
COPY client/package.json client/package.json
COPY server/package.json server/package.json
# server's postinstall (prisma generate) runs during the install below and
# needs the schema present already — copy it ahead of the rest of the
# source so this layer still only invalidates on dependency/schema changes.
COPY server/prisma server/prisma
COPY core/package.json core/package.json
RUN bun install --frozen-lockfile --filter='./client' --filter='./server' --filter='./core'

COPY client client
COPY server server
COPY core core

# server/src/generated is gitignored (see schema.prisma) — regenerate it
# from schema.prisma explicitly rather than relying on the postinstall
# hook above having fired for a workspace package during --filter install.
RUN cd server && bunx prisma generate

# Vite bakes VITE_-prefixed env vars into the client bundle at build time,
# not read at runtime — pass this through as a build arg if you want
# client-side Sentry reporting (see client/.env's comment). Safe to leave
# unset: main.tsx's Sentry.init() is a documented no-op without a DSN.
ARG VITE_SENTRY_DSN
ENV VITE_SENTRY_DSN=$VITE_SENTRY_DSN

RUN cd client && bun run build

ENV NODE_ENV=production
EXPOSE 3001

# server/package.json's "start" script runs `prisma migrate deploy` before
# starting the server, so pending migrations apply on every deploy.
CMD ["bun", "run", "--filter", "server", "start"]
