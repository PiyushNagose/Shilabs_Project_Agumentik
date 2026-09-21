# Domain Events

R11 adds a persisted domain event outbox for reliable handoff between transactional application state and later asynchronous processing.

Responsibilities:

- persist facts that already happened, such as `REPLY_UNDERSTOOD` or `NEGOTIATION_DETECTED`
- enforce idempotency with a unique `idempotencyKey`
- carry `correlationId` for tracing a trigger across later jobs
- expose durable status, attempts, locks, failure details, and retry requests
- allow events to be created inside the same Prisma transaction as the state transition

Non-responsibilities:

- no Redis or BullMQ dispatch yet
- no external provider calls
- no email, WhatsApp, meeting, proposal, or follow-up execution
- no successful Zoho timeline write unless the underlying external action already succeeded

R12 is expected to connect this persisted outbox to durable worker execution.
