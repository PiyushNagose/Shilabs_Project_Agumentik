const { spawn } = require("node:child_process");

const processes = [
  spawn(process.execPath, ["apps/api/dist/server.js"], { stdio: "inherit", env: process.env }),
  spawn(process.execPath, ["apps/worker/dist/worker.js"], { stdio: "inherit", env: process.env })
];

let stopping = false;

function stop(signal, exitCode = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of processes) {
    if (!child.killed) child.kill(signal);
  }
  setTimeout(() => process.exit(exitCode), 10_000).unref();
}

for (const child of processes) {
  child.on("error", (error) => {
    console.error("Production process failed to start", error);
    stop("SIGTERM", 1);
  });
  child.on("exit", (code, signal) => {
    if (stopping) return;
    console.error(`Production process exited (${signal ?? String(code ?? 1)})`);
    stop("SIGTERM", code ?? 1);
  });
}

process.on("SIGINT", () => stop("SIGINT"));
process.on("SIGTERM", () => stop("SIGTERM"));
