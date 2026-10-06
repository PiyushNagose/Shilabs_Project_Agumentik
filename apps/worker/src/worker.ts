import { startWorkerRuntime } from "./runtime.js";

const runtime = await startWorkerRuntime();

console.log("Worker booted", runtime.status);

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`Received ${signal}; closing worker`);
  await runtime.close();
  process.exitCode = 0;
}

let shuttingDown = false;

process.on("SIGINT", (signal) => {
  void shutdown(signal);
});
process.on("SIGTERM", (signal) => {
  void shutdown(signal);
});
