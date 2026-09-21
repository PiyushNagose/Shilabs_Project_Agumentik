import type { ConnectionOptions } from "bullmq";

export function redisConnectionFromUrl(redisUrl: string): ConnectionOptions {
  const parsed = new URL(redisUrl);
  if (parsed.protocol !== "redis:" && parsed.protocol !== "rediss:") {
    throw new Error("REDIS_URL must use redis:// or rediss://");
  }

  const db = parsed.pathname.length > 1 ? Number(parsed.pathname.slice(1)) : undefined;
  if (db !== undefined && (!Number.isInteger(db) || db < 0)) {
    throw new Error("REDIS_URL database index must be a non-negative integer");
  }

  return {
    host: parsed.hostname,
    port: Number(parsed.port || 6379),
    username: parsed.username ? decodeURIComponent(parsed.username) : undefined,
    password: parsed.password ? decodeURIComponent(parsed.password) : undefined,
    db,
    tls: parsed.protocol === "rediss:" ? {} : undefined,
    maxRetriesPerRequest: null
  };
}
