import express, { type Request, type Response } from "express";
import cors from "cors";
import { toNodeHandler } from "better-auth/node";
import { auth } from "./lib/auth.js";
import { prisma } from "./lib/prisma.js";
import { sessionMiddleware } from "./middleware/session.js";

const app = express();
const port = process.env.PORT ?? 3001;
const clientOrigin = process.env.CLIENT_ORIGIN ?? "http://localhost:5173";

app.use(cors({ origin: clientOrigin, credentials: true }));
app.all("/api/auth/*splat", toNodeHandler(auth));

app.use(express.json());
app.use(sessionMiddleware);

app.get("/api/health", async (_req: Request, res: Response) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: "ok", database: "connected" });
  } catch {
    res.status(503).json({ status: "ok", database: "unreachable" });
  }
});

app.get("/api/hello", (_req: Request, res: Response) => {
  res.json({ message: "Hello from the Express + Bun API" });
});

app.get("/api/me", (req: Request, res: Response) => {
  if (!req.user) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  res.json({ user: req.user });
});

app.listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`);
});
