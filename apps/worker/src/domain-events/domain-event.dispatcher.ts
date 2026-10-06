import type { Queue } from "bullmq";
import { getWorkerConfig } from "@shilabs/shared-config";
import {
  DOMAIN_EVENT_PROCESS_JOB,
  type DomainEventProcessJobData
} from "../queues/domain-event.constants.js";
import {
  findDueDomainEvents,
  expireExhaustedPendingDomainEvents,
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
  const queuedStaleBefore = new Date(now.getTime() - config.domainEventQueuedStaleAfterMs);
  const processingStaleBefore = new Date(now.getTime() - config.domainEventStaleAfterMs);
  const expired = await expireExhaustedPendingDomainEvents(now);
  const recovered = await recoverStaleDomainEvents({
    queuedStaleBefore,
    processingStaleBefore,
    now,
    limit: input.limit ?? config.domainEventDispatchLimit
  });
  const events = await findDueDomainEvents({
    now,
    limit: input.limit ?? config.domainEventDispatchLimit
  });

  let dispatched = 0;
  for (const event of events) {
    const queueJobId = `${event.id}:${String(event.attempts + 1)}:${String(now.getTime())}`;
    // Reserve persisted work first. A failed queue add remains QUEUED and is recovered by the
    // existing stale-event pass; a fast BullMQ worker can never observe a PENDING event.
    const queued = await markDomainEventQueued({
      eventId: event.id,
      queueName: input.queue.name,
      queueJobId,
      now
    });
    if (!queued) continue;
    await input.queue.add(
      DOMAIN_EVENT_PROCESS_JOB,
      { eventId: event.id, idempotencyKey: event.idempotencyKey },
      {
        jobId: queueJobId,
        removeOnComplete: { age: 86400, count: 1000 },
        removeOnFail: false
      }
    );
    dispatched += 1;
  }

  return { dispatched, recovered: recovered + expired };
}
