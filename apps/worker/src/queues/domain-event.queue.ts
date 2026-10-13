import { Queue, Worker as BullWorker, type Job } from "bullmq";
import { emitOperationalAlert, getWorkerConfig } from "@shilabs/shared-config";
import { dispatchDueDomainEvents } from "../domain-events/domain-event.dispatcher.js";
import { processDomainEventJob } from "../domain-events/domain-event.processor.js";
import {
  DOMAIN_EVENT_DISPATCH_JOB,
  DOMAIN_EVENT_DISPATCH_JOB_ID,
  DOMAIN_EVENT_PROCESS_JOB,
  type DomainEventDispatchJobData,
  type DomainEventProcessJobData
} from "./domain-event.constants.js";
import { redisConnectionFromUrl } from "./redis.js";

type DomainEventJobData = DomainEventDispatchJobData | DomainEventProcessJobData;

export interface StartedDomainEventWorker {
  queue: Queue<DomainEventJobData>;
  worker: BullWorker<DomainEventJobData>;
}

export function createDomainEventQueue(
  env: NodeJS.ProcessEnv = process.env
): Queue<DomainEventJobData> {
  const config = getWorkerConfig(env);
  return new Queue<DomainEventJobData>(config.domainEventQueueName, {
    connection: redisConnectionFromUrl(config.redisUrl)
  });
}

async function processJob(
  job: Job<DomainEventJobData>,
  queue: Queue<DomainEventJobData>
): Promise<unknown> {
  if (job.name === DOMAIN_EVENT_DISPATCH_JOB) {
    return dispatchDueDomainEvents({ queue });
  }
  if (job.name === DOMAIN_EVENT_PROCESS_JOB) {
    const data = job.data as DomainEventProcessJobData;
    return processDomainEventJob({
      eventId: data.eventId,
      queueJobId: job.id ?? data.eventId,
      workerId: `bullmq:${job.queueName}:${String(process.pid)}`
    });
  }
  throw new Error(`Unsupported domain event job ${job.name}`);
}

export async function startDomainEventWorker(
  env: NodeJS.ProcessEnv = process.env
): Promise<StartedDomainEventWorker> {
  const config = getWorkerConfig(env);
  const connection = redisConnectionFromUrl(config.redisUrl);
  const queue = new Queue<DomainEventJobData>(config.domainEventQueueName, { connection });
  const worker = new BullWorker<DomainEventJobData>(
    config.domainEventQueueName,
    (job) => processJob(job, queue),
    {
      connection,
      concurrency: config.domainEventWorkerConcurrency
    }
  );
  worker.on("failed", (job, error) => {
    void emitOperationalAlert(
      {
        category: "queue_failure",
        severity: "error",
        message: error.message,
        correlationId:
          job?.name === DOMAIN_EVENT_PROCESS_JOB
            ? (job.data as DomainEventProcessJobData).eventId
            : job?.id,
        metadata: {
          queue: config.domainEventQueueName,
          job: job?.name ?? "unknown",
          attemptsMade: job?.attemptsMade ?? 0
        }
      },
      env
    );
  });
  worker.on("error", (error) => {
    void emitOperationalAlert(
      {
        category: "queue_runtime_failure",
        severity: "critical",
        message: error.message,
        metadata: { queue: config.domainEventQueueName }
      },
      env
    );
  });

  await queue.upsertJobScheduler(
    DOMAIN_EVENT_DISPATCH_JOB_ID,
    { every: config.domainEventDispatchIntervalMs },
    {
      name: DOMAIN_EVENT_DISPATCH_JOB,
      data: { requestedAt: new Date().toISOString() },
      opts: {
        removeOnComplete: { age: 3600, count: 100 },
        removeOnFail: false
      }
    }
  );

  return { queue, worker };
}

export async function closeDomainEventWorker(started: StartedDomainEventWorker): Promise<void> {
  await started.worker.close();
  await started.queue.close();
}
