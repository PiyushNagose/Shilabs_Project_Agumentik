export interface ApiConfig {
  host: string;
  port: number;
  nodeEnv: string;
  webOrigin: string;
}

export interface WorkerConfig {
  redisUrl: string;
  nodeEnv: string;
  domainEventQueueName: string;
  domainEventWorkerConcurrency: number;
  domainEventDispatchLimit: number;
  domainEventDispatchIntervalMs: number;
  domainEventStaleAfterMs: number;
}

export interface AuthConfig {
  jwtSecret: string;
  accessTokenTtlSeconds: number;
  bcryptSaltRounds: number;
}

export function getApiConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  return {
    host: env.API_HOST ?? "0.0.0.0",
    port: Number(env.API_PORT ?? 4000),
    nodeEnv: env.NODE_ENV ?? "development",
    webOrigin: env.WEB_ORIGIN ?? "http://localhost:5173"
  };
}

export function getWorkerConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  return {
    redisUrl: env.REDIS_URL ?? "",
    nodeEnv: env.NODE_ENV ?? "development",
    domainEventQueueName: env.DOMAIN_EVENT_QUEUE_NAME ?? "domain-events",
    domainEventWorkerConcurrency: Number(env.DOMAIN_EVENT_WORKER_CONCURRENCY ?? 5),
    domainEventDispatchLimit: Number(env.DOMAIN_EVENT_DISPATCH_LIMIT ?? 25),
    domainEventDispatchIntervalMs: Number(env.DOMAIN_EVENT_DISPATCH_INTERVAL_MS ?? 60000),
    domainEventStaleAfterMs: Number(env.DOMAIN_EVENT_STALE_AFTER_MS ?? 900000)
  };
}

export function getAuthConfig(env: NodeJS.ProcessEnv = process.env): AuthConfig {
  const jwtSecret = env.JWT_SECRET ?? "";
  const accessTokenTtlSeconds = Number(env.JWT_ACCESS_TOKEN_TTL_SECONDS ?? 3600);
  const bcryptSaltRounds = Number(env.BCRYPT_SALT_ROUNDS ?? 12);

  if (jwtSecret.length < 32) {
    throw new Error("JWT_SECRET must be at least 32 characters long");
  }

  if (!Number.isInteger(accessTokenTtlSeconds) || accessTokenTtlSeconds <= 0) {
    throw new Error("JWT_ACCESS_TOKEN_TTL_SECONDS must be a positive integer");
  }

  if (!Number.isInteger(bcryptSaltRounds) || bcryptSaltRounds < 10 || bcryptSaltRounds > 15) {
    throw new Error("BCRYPT_SALT_ROUNDS must be an integer between 10 and 15");
  }

  return {
    jwtSecret,
    accessTokenTtlSeconds,
    bcryptSaltRounds
  };
}
