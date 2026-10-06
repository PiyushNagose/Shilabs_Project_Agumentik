import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { assertTestDatabaseEnvironment } =
  require("../../../scripts/verify-test-environment.cjs") as {
    assertTestDatabaseEnvironment: (env: NodeJS.ProcessEnv) => void;
  };

const testUrl = "postgresql://shilabs:test@localhost:5433/shilabs_test";

describe("test database environment guard", () => {
  it("accepts an explicit local test database", () => {
    expect(() =>
      assertTestDatabaseEnvironment({
        NODE_ENV: "test",
        DATABASE_URL: testUrl,
        TEST_DATABASE_URL: testUrl
      })
    ).not.toThrow();
  });

  it.each([
    [{ DATABASE_URL: testUrl, TEST_DATABASE_URL: testUrl }, "NODE_ENV must be test"],
    [
      { NODE_ENV: "test", DATABASE_URL: testUrl },
      "TEST_DATABASE_URL must be explicitly configured"
    ],
    [
      {
        NODE_ENV: "test",
        DATABASE_URL: "postgresql://shilabs:test@localhost:5433/shilabs_sales",
        TEST_DATABASE_URL: testUrl
      },
      "DATABASE_URL must exactly match TEST_DATABASE_URL"
    ],
    [
      {
        NODE_ENV: "test",
        DATABASE_URL: "postgresql://shilabs:test@localhost:5433/shilabs_sales",
        TEST_DATABASE_URL: "postgresql://shilabs:test@localhost:5433/shilabs_sales"
      },
      "database name must contain a distinct test segment"
    ]
  ])("rejects unsafe test configuration", (env, message) => {
    expect(() => assertTestDatabaseEnvironment(env)).toThrow(message);
  });
});
