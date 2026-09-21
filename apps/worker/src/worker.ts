import { startWorkerRuntime } from "./runtime.js";

const runtime = await startWorkerRuntime();

console.log("Worker booted", runtime.status);

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  console.log(`Received ${signal}; closing worker`);
  await runtime.close();
  process.exit(0);
}

process.on("SIGINT", (signal) => {
  void shutdown(signal);
});
process.on("SIGTERM", (signal) => {
  void shutdown(signal);
});
