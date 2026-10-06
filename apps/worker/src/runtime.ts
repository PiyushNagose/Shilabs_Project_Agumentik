import { getWorkerConfig } from "@shilabs/shared-config";
import type { WorkerStatus } from "@shilabs/shared-types";
import { closeDomainEventWorker, startDomainEventWorker } from "./queues/domain-event.queue.js";
import { workerPrisma } from "./domain-events/domain-event.repository.js";

export function createWorkerRuntime(env: NodeJS.ProcessEnv = process.env): WorkerStatus {
  const config = getWorkerConfig(env);
  const redisConfigured = config.redisUrl.length > 0;

  return {
    status: redisConfigured ? "ok" : "degraded",
    service: "worker",
    queuesEnabled: redisConfigured,
    redisUrlConfigured: redisConfigured,
    redisStatus: redisConfigured ? "CONFIGURED" : "NOT_CONFIGURED",
    domainEventQueueName: config.domainEventQueueName
  };
}

export async function startWorkerRuntime(env: NodeJS.ProcessEnv = process.env): Promise<{
  status: WorkerStatus;
  close: () => Promise<void>;
}> {
  const status = createWorkerRuntime(env);
  await workerPrisma.$queryRaw`SELECT 1`;
  if (!status.queuesEnabled) {
    return { status, close: () => workerPrisma.$disconnect() };
  }

  const worker = await startDomainEventWorker(env);
  return {
    status,
    close: async () => {
      await closeDomainEventWorker(worker);
      await workerPrisma.$disconnect();
    }
  };
}
