import http from "node:http";
import { createApp } from "../../app.js";
import { prisma } from "../../shared/prisma.js";
import { installRealtimeWebSocketServer } from "./realtime.service.js";

const databaseUrl = new URL(process.env.DATABASE_URL ?? "");
if (
  process.env.NODE_ENV !== "test" ||
  process.env.DATABASE_URL !== process.env.TEST_DATABASE_URL ||
  !["localhost", "127.0.0.1", "[::1]"].includes(databaseUrl.hostname) ||
  !/^codex_test_[A-Za-z0-9_]+$/.test(databaseUrl.searchParams.get("schema") ?? "") ||
  !process.send
) {
  throw new Error("Realtime child fixture requires IPC and an isolated local test database");
}

const server = http.createServer(createApp());
const stopRealtime = installRealtimeWebSocketServer(server);
let stopping = false;
async function stop(): Promise<void> {
  if (stopping) return;
  stopping = true;
  await stopRealtime();
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve()))
  );
  await prisma.$disconnect();
  if (process.connected) process.disconnect();
}
function requestStop(): void {
  void stop().catch(() => process.exit(1));
}
process.on("message", (message: unknown) => {
  if (message && typeof message === "object" && "type" in message && message.type === "stop")
    requestStop();
});
process.on("disconnect", requestStop);
process.on("SIGTERM", requestStop);
server.listen(0, "127.0.0.1", () => {
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Realtime fixture failed to bind");
  process.send?.({
    type: "ready",
    pid: process.pid,
    baseUrl: `http://127.0.0.1:${String(address.port)}`
  });
});
