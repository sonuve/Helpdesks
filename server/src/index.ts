import { app } from "./app.js";
import { startQueue } from "./lib/queue.js";
import { initSentry, Sentry } from "./lib/sentry.js";

initSentry();
// Added after all routes are mounted (app.ts's module-level app.use()
// calls above already ran by the time this executes) and before any other
// error-handling middleware (app.ts has none) — see lib/sentry.ts.
Sentry.setupExpressErrorHandler(app);

const port = process.env.PORT ?? 3001;

await startQueue();

app.listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`);
});
