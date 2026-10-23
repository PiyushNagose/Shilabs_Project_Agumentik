import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["apps/api/src/modules/email/email-ses-receiving.*.test.ts"],
    maxWorkers: 1,
    fileParallelism: false
  }
});
