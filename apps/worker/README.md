# Worker App

Background worker process for delayed, retryable and asynchronous work.

R12 enables Redis/BullMQ for durable domain-event execution.

Runtime rules:

- PostgreSQL `DomainEventOutbox` remains the durable state/evidence source.
- Redis/BullMQ carries deduplicated execution jobs and a recurring dispatcher job.
- Missing `REDIS_URL` reports `degraded` / `NOT_CONFIGURED` and does not fake job execution.
- The worker revalidates communication eligibility before any communication side-effect event can run.
- R12 does not implement follow-up, email send, call, WhatsApp, proposal or meeting business automation.
