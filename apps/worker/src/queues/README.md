# Queues

R12 adds the `domain-events` BullMQ queue.

The queue stores:

- recurring dispatcher jobs that scan due PostgreSQL outbox rows
- one processing job per outbox event, using the outbox event ID as the BullMQ `jobId`

Redis is not the source of truth. If a queued/processing outbox row becomes stale, the
dispatcher returns it to `PENDING` or moves it to `ATTENTION_REQUIRED` when attempts are
exhausted.
