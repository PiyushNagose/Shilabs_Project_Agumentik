import { createApp } from "./app.js";
import { getApiConfig } from "@shilabs/shared-config";
import { installExotelVoiceAiWebSocketServer } from "./modules/voice/voice-ai.realtime.js";
import { installRealtimeWebSocketServer } from "./modules/realtime/realtime.service.js";

const config = getApiConfig();
const app = createApp();

const server = app.listen(config.port, config.host, () => {
  console.log(`API listening on http://${config.host}:${String(config.port)}`);
});
installExotelVoiceAiWebSocketServer(server);
installRealtimeWebSocketServer(server);

function shutdown(signal: NodeJS.Signals): void {
  console.log(`Received ${signal}; closing API server`);
  server.close(() => {
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
