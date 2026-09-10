import express, { type Request, type Response } from "express";
import cors from "cors";
import { toNodeHandler } from "better-auth/node";
import { auth } from "./lib/auth.js";
import { prisma } from "./lib/prisma.js";
import { sessionMiddleware } from "./middleware/session.js";
import { apiLimiter } from "./middleware/rate-limit.js";
import { usersRouter } from "./routes/users.js";

const app = express();
const port = process.env.PORT ?? 3001;
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

app.listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`);
});
