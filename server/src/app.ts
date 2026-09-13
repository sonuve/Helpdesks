import { existsSync } from "node:fs";
import path from "node:path";
import express, { type Request, type Response } from "express";
import cors from "cors";
import { toNodeHandler } from "better-auth/node";
import { auth } from "./lib/auth.js";
import { prisma } from "./lib/prisma.js";
import { sessionMiddleware } from "./middleware/session.js";
import { apiLimiter } from "./middleware/rate-limit.js";
import { usersRouter } from "./routes/users.js";
import { ticketsRouter } from "./routes/tickets.js";
import { inboundEmailRouter } from "./routes/inbound-email.js";

// Split from index.ts so tests can import the configured app directly
// (e.g. via supertest) without binding a real port — see
// routes/tickets.test.ts.
export const app = express();
const clientOrigin = process.env.CLIENT_ORIGIN ?? "http://localhost:5173";

// Trust exactly the proxies named in TRUSTED_PROXY_CIDRS (e.g. the ALB's
// VPC block in production) so req.ip is the real client, not the proxy.
// Left unset (trust nothing) in local dev, where there's no proxy.
const trustedProxies = (process.env.TRUSTED_PROXY_CIDRS ?? "")
  .split(",")
  .map((cidr) => cidr.trim())
  .filter(Boolean);
app.set("trust proxy", trustedProxies.length > 0 ? trustedProxies : false);

app.use(cors({ origin: clientOrigin, credentials: true }));
// better-auth has its own rate limiting (see lib/auth.ts) covering
// everything under /api/auth/*, so this general limiter only needs to
// cover the routes defined below.
app.all("/api/auth/*splat", toNodeHandler(auth));

app.use(express.json());
app.use(sessionMiddleware);

// No limiter here: this is an infra health probe (e.g. the ALB target
// group) and must not be throttled.
app.get("/api/health", async (_req: Request, res: Response) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: "ok", database: "connected" });
  } catch {
    res.status(503).json({ status: "error", database: "unreachable" });
  }
});

app.get("/api/hello", apiLimiter, (_req: Request, res: Response) => {
  res.json({ message: "Hello from the Express + Bun API" });
});

app.use(usersRouter);
app.use(ticketsRouter);
app.use(inboundEmailRouter);

// Single-service deployment (Railway/Render): the client has no
// configurable API base URL (it fetches relative /api/* paths,
// same-origin only — see vite.config.ts's dev-only proxy), so production
// serves the built SPA from this same Express app/origin rather than
// hosting it separately. Registered last, after every /api/* route above,
// so an unmatched /api path still falls through to those rather than
// being swallowed by the catch-all below.
//
// Gated on the built client actually existing rather than
// NODE_ENV === "production": some platforms don't reliably thread a
// configured NODE_ENV value through to the running container the way
// you'd expect, and "is there a built index.html to serve" is the real
// question anyway — it's false in dev (no one runs `vite build` there)
// and in tests (supertest imports this file directly, never building the
// client), and true in exactly the deployed-image case this exists for.
const clientDist = path.resolve(import.meta.dirname, "../../client/dist");
if (existsSync(path.join(clientDist, "index.html"))) {
  app.use(express.static(clientDist));
  app.get("/{*splat}", (_req: Request, res: Response) => {
    res.sendFile(path.join(clientDist, "index.html"));
  });
}
