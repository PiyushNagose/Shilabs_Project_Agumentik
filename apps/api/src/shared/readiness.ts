import { Redis } from "ioredis";
import { emitOperationalAlert } from "@shilabs/shared-config";
import { prisma } from "./prisma.js";

let readinessRedis: Redis | null = null;

function getReadinessRedis(): Redis | null {
  const redisUrl = process.env.REDIS_URL?.trim();
  if (!redisUrl) return null;
  readinessRedis ??= new Redis(redisUrl, {
    lazyConnect: true,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    connectTimeout: 3000
  });
  return readinessRedis;
}

export interface ReadinessResult {
  ready: boolean;
  dependencies: {
    database: "ok" | "error";
    redis: "ok" | "error" | "not-required";
  };
}

export async function checkReadiness(): Promise<ReadinessResult> {
  let database: ReadinessResult["dependencies"]["database"] = "ok";
  let redisStatus: ReadinessResult["dependencies"]["redis"] = "not-required";
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (error) {
    database = "error";
    void emitOperationalAlert({
      category: "database_health_failure",
      severity: "critical",
      message: error instanceof Error ? error.message : "Database readiness failed"
    });
  }

  const redis = getReadinessRedis();
  if (redis) {
    try {
      if (redis.status === "wait") await redis.connect();
      await redis.ping();
      redisStatus = "ok";
    } catch (error) {
      redisStatus = "error";
      void emitOperationalAlert({
        category: "redis_health_failure",
        severity: "critical",
        message: error instanceof Error ? error.message : "Redis readiness failed"
      });
    }
  }

  return {
    ready: database === "ok" && redisStatus !== "error",
    dependencies: { database, redis: redisStatus }
  };
}

export async function closeReadinessDependencies(): Promise<void> {
  const redis = readinessRedis;
  readinessRedis = null;
  if (redis && redis.status !== "end") {
    await redis.quit().catch(() => redis.disconnect());
  }
}
