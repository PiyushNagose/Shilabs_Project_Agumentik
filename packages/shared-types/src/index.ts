export type ServiceName = "api" | "worker" | "web";

export interface HealthResponse {
  status: "ok";
  service: ServiceName;
  uptimeSeconds: number;
  timestamp: string;
}

export interface WorkerStatus {
  status: "ok";
  service: "worker";
  queuesEnabled: boolean;
  redisUrlConfigured: boolean;
}
