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
- `AuthSession` added in M2 for server-side authentication invalidation

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

## M2 Authentication And RBAC

Authentication is in-house. Users authenticate with email and password, passwords are stored only as bcrypt hashes, and active sessions are recorded in PostgreSQL. Bearer access tokens include a session identifier; protected API routes re-check the token against `AuthSession` and the current `User.status`.

Roles are limited to the documented MVP roles:

- `ADMIN`
- `SALES_MANAGER`
- `SALES_REP`

Admins can create, update and deactivate users. Sales managers can list/read users. Sales reps can read only their own user record. Business modules must use the auth/RBAC middleware rather than duplicating permission logic.

## M3 CRM Identity Foundation

Companies and contacts are managed through in-house API modules with thin controllers, services for duplicate rules, and repositories for Prisma access.

Company duplicate detection uses `normalizedWebsite` as a nullable unique domain signal. Contact duplicate detection remains company-scoped and checks normalized email, normalized phone and WhatsApp identity before creating or updating records.

M3 does not create leads, deals, activities, automation, conversations, AI behavior or frontend CRM screens.

## M4 Leads

Leads are the central CRM opportunity record and link an existing company, contact, owner and pipeline stage. M4 creates leads at the seeded `NEW` stage and keeps stage transition mechanics out of scope until M5.

Lead creation, edits, assignment and status changes write `AuditEvent` rows transactionally with the lead mutation. This gives future modules a reliable audit trail without adding the full event bus, pipeline transition engine, deal mechanics or activity feed before their milestones.

Sales reps may create leads for themselves by default. Admins and sales managers may assign leads to any active user. Lead score and temperature remain server-owned fields and are not editable through M4 APIs.
