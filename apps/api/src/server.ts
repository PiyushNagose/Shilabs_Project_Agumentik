import { createApp } from "./app.js";
import { getApiConfig } from "@shilabs/shared-config";
import { installExotelVoiceAiWebSocketServer } from "./modules/voice/voice-ai.realtime.js";
import { installRealtimeWebSocketServer } from "./modules/realtime/realtime.service.js";
import { prisma } from "./shared/prisma.js";
import { closeReadinessDependencies } from "./shared/readiness.js";

const config = getApiConfig();
const app = createApp();

const server = app.listen(config.port, config.host, () => {
  console.log(`API listening on http://${config.host}:${String(config.port)}`);
});
const closeVoiceRealtime = installExotelVoiceAiWebSocketServer(server);
const closeCrmRealtime = installRealtimeWebSocketServer(server);

let shuttingDown = false;
async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`Received ${signal}; closing API server`);
  const closeHttp = new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  try {
    await Promise.all([closeCrmRealtime(), closeVoiceRealtime(), closeHttp]);
    await closeReadinessDependencies();
    await prisma.$disconnect();
    process.exitCode = 0;
  } catch (error) {
    console.error("API shutdown failed", error);
    process.exitCode = 1;
  }
}

process.on("SIGINT", (signal) => void shutdown(signal));
process.on("SIGTERM", (signal) => void shutdown(signal));
