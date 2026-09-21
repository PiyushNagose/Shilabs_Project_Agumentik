# Messages Module

M7 message persistence is implemented through the conversations module routes.

Messages are stored in PostgreSQL, ordered by creation time, and update their parent conversation `lastMessageAt` transactionally. Provider identifiers are optional and unique when present for later integration idempotency.
