import type { Queue } from "bullmq";
import { getWorkerConfig } from "@shilabs/shared-config";
import {
  DOMAIN_EVENT_PROCESS_JOB,
  type DomainEventProcessJobData
} from "../queues/domain-event.constants.js";
import {
  findDueDomainEvents,
  markDomainEventQueued,
  recoverStaleDomainEvents
} from "./domain-event.repository.js";

export interface DomainEventQueueLike {
  name: string;
  add(
    name: string,
    data: DomainEventProcessJobData,
    options: {
      jobId: string;
      removeOnComplete: { age: number; count: number };
      removeOnFail: false;
    }
  ): Promise<unknown>;
}

export async function dispatchDueDomainEvents(input: {
  queue: DomainEventQueueLike | Queue<DomainEventProcessJobData>;
  limit?: number;
  now?: Date;
}): Promise<{ dispatched: number; recovered: number }> {
  const config = getWorkerConfig();
  const now = input.now ?? new Date();
  const staleBefore = new Date(now.getTime() - config.domainEventStaleAfterMs);
  const recovered = await recoverStaleDomainEvents({
    staleBefore,
    now,
    limit: input.limit ?? config.domainEventDispatchLimit
  });
  const events = await findDueDomainEvents({
    now,
    limit: input.limit ?? config.domainEventDispatchLimit
  });

  let dispatched = 0;
  for (const event of events) {
    await input.queue.add(
      DOMAIN_EVENT_PROCESS_JOB,
      { eventId: event.id, idempotencyKey: event.idempotencyKey },
      {
        jobId: event.id,
        removeOnComplete: { age: 86400, count: 1000 },
        removeOnFail: false
      }
    );
    const queued = await markDomainEventQueued({
      eventId: event.id,
      queueName: input.queue.name,
      queueJobId: event.id,
      now
    });
    if (queued) dispatched += 1;
  }

  return { dispatched, recovered };
}
