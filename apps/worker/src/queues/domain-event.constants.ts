export const DOMAIN_EVENT_DISPATCH_JOB = "domain-events.dispatch-due";
export const DOMAIN_EVENT_PROCESS_JOB = "domain-events.process";
export const DOMAIN_EVENT_DISPATCH_JOB_ID = "domain-events.dispatch-scheduler";

export interface DomainEventProcessJobData {
  eventId: string;
  idempotencyKey: string;
}

export interface DomainEventDispatchJobData {
  requestedAt: string;
}
