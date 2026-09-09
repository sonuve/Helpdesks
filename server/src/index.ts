import express, { type Request, type Response } from "express";

const app = express();
const port = process.env.PORT ?? 3001;

app.use(express.json());

app.get("/api/health", (_req: Request, res: Response) => {
  res.json({ status: "ok" });
});

app.get("/api/hello", (_req: Request, res: Response) => {
  res.json({ message: "Hello from the Express + Bun API" });
});

app.listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`);
});
