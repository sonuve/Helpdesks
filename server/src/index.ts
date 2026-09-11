import { app } from "./app.js";
import { startQueue } from "./lib/queue.js";

const port = process.env.PORT ?? 3001;

await startQueue();

app.listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`);
});
