import express, { type Request, type Response } from "express";
import { prisma } from "./lib/prisma.js";

const app = express();
const port = process.env.PORT ?? 3001;

app.use(express.json());

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

app.listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`);
});
