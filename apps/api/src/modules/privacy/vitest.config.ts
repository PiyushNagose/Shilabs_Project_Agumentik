import { defineConfig } from "vitest/config";

// All dependencies that can connect to PostgreSQL are mocked in these tests.
export default defineConfig({ test: {
  environment: "node", include: ["apps/api/src/modules/privacy/privacy.records.test.ts", "apps/api/src/modules/privacy/privacy.service.test.ts", "apps/api/src/modules/privacy/privacy.routes.test.ts"],
  fileParallelism: false, testTimeout: 10000
} });
