function fail(message) {
  throw new Error(`Unsafe test environment: ${message}`);
}

function assertTestDatabaseEnvironment(env = process.env) {
  if (env.NODE_ENV !== "test") fail("NODE_ENV must be test");
  if (!env.TEST_DATABASE_URL) fail("TEST_DATABASE_URL must be explicitly configured");
  if (env.DATABASE_URL !== env.TEST_DATABASE_URL) {
    fail("DATABASE_URL must exactly match TEST_DATABASE_URL");
  }

  let parsed;
  try {
    parsed = new URL(env.TEST_DATABASE_URL);
  } catch {
    fail("TEST_DATABASE_URL must be a valid PostgreSQL URL");
  }
  if (!["postgres:", "postgresql:"].includes(parsed.protocol)) {
    fail("TEST_DATABASE_URL must use postgres:// or postgresql://");
  }
  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  if (!/(^|[-_])test($|[-_])/iu.test(databaseName)) {
    fail("the database name must contain a distinct test segment");
  }
  const localHosts = new Set(["localhost", "127.0.0.1", "::1", "postgres"]);
  if (!localHosts.has(parsed.hostname) && env.ALLOW_REMOTE_TEST_DATABASE !== "true") {
    fail("remote test databases require ALLOW_REMOTE_TEST_DATABASE=true");
  }
}

module.exports = { assertTestDatabaseEnvironment };
