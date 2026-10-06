import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  server: {
    port: Number(process.env.WEB_PORT ?? 5173)
  },
  test: {
    exclude: ["dist/**", "node_modules/**"]
  }
});
