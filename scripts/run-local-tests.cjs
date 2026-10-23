const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { parse } = require("dotenv");
const { assertTestDatabaseEnvironment } = require("./verify-test-environment.cjs");

const root = path.resolve(__dirname, "..");
const settings = Object.assign({}, ...[".env"].map((file) =>
  fs.existsSync(path.join(root, file)) ? parse(fs.readFileSync(path.join(root, file))) : {}));
const url = new URL(settings.DATABASE_URL);
if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
  throw new Error("Local regression requires a local PostgreSQL database");
}
const schema = process.env.LOCAL_TEST_SCHEMA || "codex_test_final_20261018_2249";
if (!/^codex_test_[A-Za-z0-9_]+$/.test(schema)) throw new Error("Invalid isolated test schema");
url.searchParams.set("schema", schema);
const redis = new URL(settings.REDIS_URL || "redis://localhost:6380");
redis.pathname = "/1";
const env = {
  ...process.env, NODE_ENV: "test", DATABASE_URL: url.toString(), TEST_DATABASE_URL: url.toString(),
  DIRECT_DATABASE_URL: url.toString(), REDIS_URL: redis.toString(), BCRYPT_SALT_ROUNDS: "10",
  JWT_SECRET: "isolated-local-regression-secret-32-chars", AI_PROVIDER: "openai",
  OPENAI_API_KEY: "test-only-not-a-real-key", OPENAI_MODEL: "test-model",
  OPENAI_EMBEDDING_MODEL: "test-embedding-model", REALTIME_INTERNAL_SECRET: "test-only-realtime-secret",
  EXOTEL_WEBHOOK_SECRET: "test-only-exotel-webhook-secret", VOICE_AI_STREAM_TOKEN: "test-only-voice-stream-signing-secret"
};
assertTestDatabaseEnvironment(env);
const args = process.argv.slice(2);
const prepareIndex = args.indexOf("--prepare");
if (prepareIndex !== -1) {
  args.splice(prepareIndex, 1);
  const create = `const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();p.$executeRawUnsafe('CREATE SCHEMA IF NOT EXISTS "${schema}"').finally(()=>p.$disconnect());`;
  for (const command of [
    ["-e", create],
    ["scripts/run-prisma.cjs", "migrate", "deploy", "--schema", "apps/api/prisma/schema.prisma"],
    ["--import", "tsx", "apps/api/prisma/seed.ts"]
  ]) {
    const result = spawnSync(process.execPath, command, { cwd: root, env, stdio: "inherit" });
    if (result.error) throw result.error;
    if (result.status !== 0) process.exit(result.status ?? 1);
  }
}
const vitest = path.join(path.dirname(require.resolve("vitest/package.json")), "vitest.mjs");
const result = spawnSync(process.execPath, [vitest, "run", "--reporter=dot", "--no-file-parallelism",
  "--maxWorkers=1", "--testTimeout=45000", "--hookTimeout=45000", ...args], { cwd: root, env, stdio: "inherit" });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
