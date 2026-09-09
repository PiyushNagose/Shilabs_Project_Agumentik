import { createWorkerRuntime } from "./runtime.js";

const runtime = createWorkerRuntime();

console.log("Worker booted", runtime);

function shutdown(signal: NodeJS.Signals): void {
  console.log(`Received ${signal}; closing worker`);
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
