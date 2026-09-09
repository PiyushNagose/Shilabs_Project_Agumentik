import { createApp } from "./app.js";
import { getApiConfig } from "@shilabs/shared-config";

const config = getApiConfig();
const app = createApp();

const server = app.listen(config.port, config.host, () => {
  console.log(`API listening on http://${config.host}:${String(config.port)}`);
});

function shutdown(signal: NodeJS.Signals): void {
  console.log(`Received ${signal}; closing API server`);
  server.close(() => {
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
