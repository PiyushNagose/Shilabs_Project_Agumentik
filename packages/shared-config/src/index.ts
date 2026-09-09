export interface ApiConfig {
  host: string;
  port: number;
  nodeEnv: string;
}

export interface WorkerConfig {
  redisUrl: string;
  nodeEnv: string;
}

export function getApiConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  return {
    host: env.API_HOST ?? "0.0.0.0",
    port: Number(env.API_PORT ?? 4000),
    nodeEnv: env.NODE_ENV ?? "development"
  };
}

export function getWorkerConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  return {
    redisUrl: env.REDIS_URL ?? "",
    nodeEnv: env.NODE_ENV ?? "development"
  };
}
