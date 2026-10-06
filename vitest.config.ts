import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["apps/**/*.test.ts", "apps/**/*.test.tsx", "packages/**/*.test.ts"],
    globalSetup: ["./scripts/vitest-global-setup.ts"],
    fileParallelism: false,
    testTimeout: 45000,
    hookTimeout: 45000
  }
});
