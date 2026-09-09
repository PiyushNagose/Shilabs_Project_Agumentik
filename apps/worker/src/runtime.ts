import { getWorkerConfig } from "@shilabs/shared-config";
import type { WorkerStatus } from "@shilabs/shared-types";

export function createWorkerRuntime(): WorkerStatus {
  const config = getWorkerConfig();

  return {
    status: "ok",
    service: "worker",
    queuesEnabled: false,
    redisUrlConfigured: config.redisUrl.length > 0
  };
}
