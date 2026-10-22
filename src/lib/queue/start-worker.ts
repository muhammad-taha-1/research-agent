// The worker process: `npm run worker` (or `npm run dev:all` for the app and worker together).
// Runs agent jobs from the queue, independent of any HTTP request.

import { startWorker } from "./worker";

const { worker, close } = startWorker();

worker.on("ready", () => console.log("Worker ready, waiting for research jobs…"));

let closing = false;
async function shutdown(signal: string) {
  if (closing) return;
  closing = true;
  console.log(`${signal}: closing the worker; running jobs continue from their checkpoint on the next start`);
  try {
    await close();
  } finally {
    process.exit(0);
  }
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
