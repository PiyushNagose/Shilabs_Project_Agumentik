const { spawnSync } = require("node:child_process");
const path = require("node:path");
const { assertTestDatabaseEnvironment } = require("./verify-test-environment.cjs");

process.env.NODE_ENV = "test";
if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.JWT_SECRET ??= "test-only-jwt-secret-at-least-32-characters";
process.env.BCRYPT_SALT_ROUNDS ??= "10";
assertTestDatabaseEnvironment(process.env);

const vitestEntry = path.resolve(path.dirname(require.resolve("vitest")), "vitest.mjs");
const result = spawnSync(
  process.execPath,
  [
    vitestEntry,
    "run",
    "--reporter=verbose",
    "--no-file-parallelism",
    "--maxWorkers=1",
    "--testTimeout=45000",
    "--hookTimeout=45000",
    ...process.argv.slice(2)
  ],
  { env: process.env, stdio: "inherit" }
);
if (result.error) throw result.error;
process.exit(result.status ?? 1);
