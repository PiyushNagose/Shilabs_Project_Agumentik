import { startWorkerRuntime } from "./runtime.js";
import { assertProductionEnvironment, emitOperationalAlert } from "@shilabs/shared-config";

assertProductionEnvironment();
const runtime = await startWorkerRuntime();

console.log("Worker booted", runtime.status);

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`Received ${signal}; closing worker`);
  try {
    await runtime.close();
    process.exitCode = 0;
  } catch (error) {
    await emitOperationalAlert({
      category: "worker_shutdown_failure",
      severity: "critical",
      message: error instanceof Error ? error.message : "Worker shutdown failed"
    });
    process.exitCode = 1;
  }
}

let shuttingDown = false;

process.on("SIGINT", (signal) => {
  void shutdown(signal);
});
process.on("SIGTERM", (signal) => {
  void shutdown(signal);
});
