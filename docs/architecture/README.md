# Architecture Documentation

Architecture notes and diagrams belong here.

The approved shape is a modular monolith API, a separate worker, shared packages, PostgreSQL as source of truth, Redis/BullMQ for durable background work, and provider adapters for AI, WhatsApp, email and optional calendar sync.

## M1 Database Foundation

Prisma schema lives at `apps/api/prisma/schema.prisma` and owns database structure through migrations.

Initial entities:

- `User`
- `Company`
- `Contact`
- `Lead`
- `PipelineStage`
- `Deal`
- `Activity`
- `AuditEvent`

Pipeline stage is the ordered CRM position. Lead status is a coarser lifecycle outcome, kept separate so later APIs can filter active/closed/nurture/disqualified leads without duplicating stage transition rules in the frontend.

Contact duplicate detection uses nullable normalized identifiers with company-scoped unique constraints:

- `(companyId, normalizedEmail)`
- `(companyId, normalizedPhone)`
- `(companyId, whatsappId)`

This avoids unsafe global uniqueness while still supporting reuse and duplicate detection within a company account. PostgreSQL permits multiple null values in unique indexes, so unknown email/phone/WhatsApp values do not collide.

Audit events use optional JSON snapshots for `before` and `after` because audit records need immutable, entity-agnostic change evidence across modules. This is a deliberate limited JSON use case; core searchable state remains modeled in relational columns.

Initial pipeline probabilities:

- `NEW`: 5
- `CONTACTED`: 10
- `ENGAGED`: 25
- `QUALIFIED`: 50
- `MEETING_BOOKED`: 60
- `PROPOSAL`: 70
- `NEGOTIATION`: 85
- `WON`: 100
- `LOST`: 0
- `NURTURE`: 15
