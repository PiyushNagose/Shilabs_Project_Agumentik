# ADR-001: Database Foundation

## Status

Accepted

## Context

Shilabs AI Sales Engine must keep CRM, pipeline, workflow state, scoring, scheduling, analytics and audit history in-house. PostgreSQL is the source of truth and Prisma owns schema/migration changes.

## Decision

Use Prisma with PostgreSQL for the M1 core schema.

Use `cuid()` string IDs consistently for initial models. This keeps IDs application-generated, URL-safe and stable before distributed deployment details are known.

Separate operational activity history from audit history:

- `Activity` is lead-facing timeline history for sales workflows.
- `AuditEvent` is append-only accountability history for important state changes.

Keep pipeline stage and lead status separate:

- `PipelineStage` describes ordered CRM position and probability.
- `LeadStatus` describes coarse lifecycle outcome for filtering and closure semantics.

Use JSON only for `AuditEvent.before` and `AuditEvent.after`, where flexible immutable snapshots are justified across many entity types.

## Consequences

M1 creates only the foundational entities needed before auth and CRM APIs. Later milestones must extend the schema through Prisma migrations and keep business behavior server-side.
