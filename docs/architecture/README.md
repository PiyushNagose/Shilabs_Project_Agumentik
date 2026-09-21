# Architecture Documentation

Architecture notes and diagrams belong here.

The revised client requirements make Shilabs a connector-first AI sales automation and orchestration layer. Zoho Bigin is the Phase 1 CRM system of record for CRM lead, contact, deal, pipeline and timeline representation. PostgreSQL remains the Shilabs source of truth for local automation state, workflow state, evidence, approvals, integration mappings, retries, audit/history and operator UX context.

See:

- `docs/architecture/r0-revised-requirements-audit.md`
- `docs/decisions/ADR-003-zoho-bigin-crm-system-of-record.md`

The approved technical shape remains a modular monolith API, a separate worker, shared packages, PostgreSQL for local orchestration state, Redis/BullMQ for durable background work, and provider adapters for Zoho Bigin, AI, AWS SES/email, WhatsApp, voice, calendar and SEMrush/SEO data where applicable.

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

Pipeline stage was originally modeled as the ordered CRM position. Under the revised requirements, local `PipelineStage` records are cached/synchronized CRM representations used for automation and UX only; Zoho Bigin owns authoritative CRM pipeline state.

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

Companies and contacts are currently managed through in-house API modules with thin controllers, services for duplicate rules, and repositories for Prisma access. R1-R4 must adapt these records into synchronized local representations mapped to Zoho Bigin, not standalone CRM master records.

Company duplicate detection uses `normalizedWebsite` as a nullable unique domain signal. Contact duplicate detection remains company-scoped and checks normalized email, normalized phone and WhatsApp identity before creating or updating records.

M3 does not create leads, deals, activities, automation, conversations, AI behavior or frontend CRM screens.

## M4 Leads

Leads were implemented as the central CRM opportunity record and link an existing company, contact, owner and pipeline stage. Under the revised requirements, `Lead` remains useful as local automation context but must be mapped to Zoho Bigin lead/contact/deal identity before it is treated as production CRM state.

Lead creation, edits, assignment and status changes write `AuditEvent` rows transactionally with the lead mutation. This gives future modules a reliable audit trail without adding the full event bus, pipeline transition engine, deal mechanics or activity feed before their milestones.

Sales reps may create leads for themselves by default. Admins and sales managers may assign leads to any active user. Lead score and temperature remain server-owned fields and are not editable through M4 APIs.

## M5 CRM Mechanics

Pipeline stages are exposed through `GET /api/pipeline/stages`, and frontend code must consume those records instead of hardcoding CRM stage behavior. `PATCH /api/leads/:id/stage` validates transitions server-side, blocks closed-to-open reopening through the normal endpoint, and transactionally writes both `Activity` and `AuditEvent` records. R4 must revisit this behavior so local stage updates cannot silently diverge from Zoho Bigin.

Deals are managed through `POST /api/deals`, `GET /api/deals/:id` and `PATCH /api/deals/:id`. A deal is linked to exactly one lead and one current pipeline stage. Under revised requirements, these deal records should become local synchronized representations of Zoho Bigin deal state, with Shilabs-owned audit/activity remaining local.

Activities are user-facing lead timeline entries. Audit events are append-only mutation evidence. Both remain in PostgreSQL and are not replaced by application logs.

## M7 Conversations And Messages

Conversations and messages are now internal source-of-truth records. The API stores conversations by lead, channel, mode and status, and stores messages with direction, sender type, body, delivery status and provider idempotency key.

M7 does not send external messages, call AI, enqueue automation or implement the simulator UI. Those behaviors attach to this data model in later milestones.

## M10 Qualification

Lead qualification is stored as structured PostgreSQL state in `LeadQualification`, with a
single qualification record per lead. Unknown sales facts remain `null`. Evidence is stored
in `LeadQualificationEvidence` and must reference an existing saved message whose body
contains the quoted text.

The qualification service is the only business module added in M10 that calls the
vendor-independent `AIProvider`. The provider extracts facts; the server validates,
merges and persists them. M10 deliberately does not update score, temperature, pipeline
stage, workflow state, messages, follow-ups or knowledge retrieval.

## M11 Lead Scoring

This section reflects old milestone work that has now been adapted under revised R8. Scoring
must not drive Zoho Bigin pipeline state unless an explicit future business rule maps
score/temperature into CRM actions.

Lead scoring is deterministic and server-owned. `ScoringConfig` stores the configurable
weights and thresholds for the default rule set. The scoring engine reads persisted
`LeadQualification` fields only, assigns points for requirement, authority, budget,
timeline and business fit, caps the score at 100, and derives temperature from the
configured warm/hot thresholds.

`POST /api/leads/:id/recalculate-score` persists `Lead.score` and `Lead.temperature` in a
transaction with `SCORE_CHANGED` activity and `LEAD_SCORE_CHANGED` audit history. AI output
cannot directly set score or temperature.

R8 adds `LeadScoreRun` history for every completed/skipped rule-engine calculation and
manual override. Runs snapshot factor output, scoring config and persisted
qualification/evidence context so operators can explain why a score changed. Human
overrides require a reason, are audited, and prevent automatic recalculation from silently
overwriting the human-owned score. Score state remains local Shilabs prioritization state.

## R9 Knowledge Base Governance

R9 adds a governed local knowledge base for later AI/reply/proposal features. Knowledge is
versioned and source-backed. Only approved entries with an active approved version are
returned through `/api/knowledge-base/approved`.

Operators with admin or sales-manager roles can create draft/approved entries, inactivate
entries and add human corrections. Corrections create a new version linked to the previous
active version and write audit history. R9 does not generate responses, proposals,
embeddings or vector search; it only establishes approved knowledge that future AI modules
must use to avoid unapproved invented case studies, prices or claims.

## R10 Reply Understanding & Response Engine

R10 adds persisted reply understanding for saved inbound email. The service uses the
existing `AIProvider`, saved conversation messages, lead/qualification context and approved
knowledge only. Structured AI output is validated for message evidence and approved-KB
references before it is persisted.

`ReplyProcessingRun` records input context, provider/model metadata, structured output,
draft text and failure state. Drafts are not sent and do not imply delivery success.
Negotiation/proposal/meeting paths remain human-controlled by switching local conversation
mode to `HUMAN` or requiring human review; follow-up scheduling and outbound send behavior
remain later milestones.

## R11 Domain Event Foundation

R11 adds a PostgreSQL-backed domain event outbox for reliable handoff from transactional
state changes to later asynchronous processing. Events store event type, aggregate identity,
payload, correlation/idempotency keys, status, attempts, lock timestamps and visible failure
details.

Domain events are persisted before any future external side effect. R11 does not dispatch
Redis/BullMQ jobs, send emails, write Zoho timeline success, or execute follow-up
automation. Those behaviors attach in later milestones and must re-check suppression,
terminal lead state and human approval gates before acting.

## R12 Worker/Queue Hardening

R12 connects the domain event outbox to Redis/BullMQ execution. PostgreSQL remains the
durable source of truth for event lifecycle, attempts, locks, retry timing and
attention-required failures. Redis stores deduplicated delivery jobs and a recurring
dispatcher job.

The worker revalidates communication eligibility at execution time for communication
side-effect event types: terminal lead state, `doNotContact`, email suppression and
conversation `HUMAN`/`PAUSED` state block execution. R12 does not implement follow-up
automation, provider sends, calls, WhatsApp, proposals or meetings.

When Redis is missing, the worker reports a degraded `NOT_CONFIGURED` state and does not
pretend jobs are running.

## R13 Follow-Up Engine

R13 adds durable first-email and Day 1/5/9 follow-up automation. Starting a sequence
persists a `FollowUpSequence`, four `FollowUpAttempt` rows, and one domain event per
attempt. The attempt content is generated once through `AIProvider` and stored before
worker execution so retries do not regenerate different copy.

The worker sends only scheduled active attempts and re-checks current lead/contact/email
suppression/conversation/reply state immediately before calling AWS SES. Provider-confirmed
SES success is required before local `OutboundEmail`, message, activity and audit success
state is recorded.

Inbound email ingestion stops active follow-up sequences and cancels pending attempts.
Zoho timeline sync is attempted only after confirmed send; Zoho failure remains visible on
the follow-up attempt and must not trigger a duplicate email send on retry.

## R1 CRM Provider Abstraction And Integration Mapping

R1 adds a provider-neutral `CRMProvider` TypeScript contract and Prisma-backed integration
metadata. No Zoho-specific OAuth, API connection, webhook verification or fake production
provider is implemented in R1.

`IntegrationAccount` stores provider account state and non-secret configuration. Secret
values must live in environment/secret management; the database stores only `secretRef`
references when needed.

`ExternalRecordMapping` is the canonical bridge between Shilabs local automation records
and Zoho Bigin records. Business modules should use mappings instead of overloading local
IDs with external IDs.

## R2 Zoho Bigin Authentication And Connectivity

R2 adds Zoho Bigin OAuth configuration parsing, refresh-token based access token exchange,
scope validation, retry behavior for transient auth/API failures, and a protected
connection health endpoint.

Credential values are read from environment variables. PostgreSQL stores only provider
status, public config, last check time, last error and a `secretRef` pointer such as
`env:ZOHO_BIGIN_CLIENT_SECRET`.

When credentials are unavailable, the endpoint returns `NOT_CONFIGURED`. When credentials
are configured but auth/API verification fails, it returns `ERROR`. It never returns a fake
connected state.

## R3 Zoho Lead/Contact Sync

R3 imports Zoho Bigin contacts through the configured contacts module and creates or
updates local synchronized representations:

- `Company` for the Zoho account/company reference.
- `Contact` for the Zoho contact identity and contact fields.
- `Lead` as Shilabs local automation context for that CRM contact.
- `ExternalRecordMapping` for each local company/contact/lead bridge.
- `IntegrationSyncRun` for run-level status, counts and failure visibility.

Zoho remains authoritative for CRM identity and CRM-sourced fields. Local automation-owned
fields such as score, temperature, next action, qualification, conversations and workflow
state are not overwritten by CRM refresh.

## R4 Zoho Deal And Timeline Sync

R4 imports Zoho deal/pipeline records as local synchronized `Deal` representations. Zoho
remains authoritative for CRM deal and pipeline state; Shilabs preserves local
automation-owned fields such as proposal status and lead score/next action when CRM deal
data refreshes.

R4 also adds idempotent timeline append support for existing local activities. The
provider call must succeed before Shilabs creates a successful `ACTIVITY`
`ExternalRecordMapping`. Failed provider writes do not create fake successful CRM timeline
state.

## R5 AWS SES Email Foundation

R5 introduces the provider-neutral `EmailProvider` boundary and an AWS SES adapter. Email
business services depend on the internal provider contract, not AWS SDK types.

`OutboundEmail` is the durable local record for outbound intent, provider acceptance,
delivery/bounce/complaint status and idempotency. SES owns the provider message ID and
actual delivery feedback; Shilabs owns suppression enforcement, retry visibility,
auditability and automation safety checks.

`EmailSuppression` is checked server-side before sends. Contact `doNotContact`, suppressed
email addresses and closed/disqualified leads block provider calls. Missing SES
configuration produces truthful `NOT_CONFIGURED` health and failed outbound records rather
than fake success.

`EmailProviderEvent` stores signed SES/SNS feedback events for idempotent processing.
Provider event payloads are stored as JSON because SES feedback payloads are external,
versioned and event-type-specific; core searchable state remains relational on
`OutboundEmail` and `EmailSuppression`.

## E2E Setup Step 1 Local Mailpit Email

Local development/demo outbound email can select `EMAIL_PROVIDER=MAILPIT`. This uses a
real SMTP adapter pointed at the Mailpit service in Docker Compose (`localhost:1025`) and
records `OutboundEmail.provider = MAILPIT` only after SMTP acceptance.

Production remains `EMAIL_PROVIDER=AWS_SES`. To prevent accidental real email sends,
configured AWS SES is blocked in non-production unless
`ALLOW_EXTERNAL_EMAIL_IN_NON_PRODUCTION=true` is deliberately set. Mailpit itself is
blocked in production and limited to local/container Mailpit hosts.

## R7 Email Deliverability & Suppression

R7 makes pre-send validation an explicit reusable service. The same server-owned
eligibility checks back both `/api/email/pre-send/validate` and `/api/email/send`:

- contact email exists and is syntactically usable
- contact is not marked `doNotContact`
- lead status is not terminal/disqualified
- normalized address is not in `EmailSuppression`

Manual/operator suppressions are persisted through guarded API endpoints and audited.
SES bounce/complaint feedback from R5 continues to upsert suppressions idempotently.
`EmailDeliverabilityScan` records aggregate scan runs for local-first health checks and
future scheduled worker execution. It never records provider success and does not replace
provider feedback.

## R6 Inbound Email / Reply Ingestion

R6 adds signed AWS SES inbound email ingestion. It does not implement the AI reply
understanding/response engine from later milestones.

Inbound email matching is deterministic:

- `X-Shilabs-Lead-Id` may map directly to a lead only when the sender matches that lead's
  contact email.
- `X-Shilabs-Outbound-Email-Id` or reply/reference headers may map through an existing
  `OutboundEmail`.
- If no explicit reference exists, exactly one non-terminal lead may match by normalized
  sender email.

Unknown, mismatched, terminal or ambiguous matches are persisted as failed `InboundEmail`
records instead of guessed. Successful ingestion creates or updates an `EMAIL`
conversation, stores an inbound `Message`, writes `MESSAGE_RECEIVED` activity and creates
audit events for `EMAIL_REPLY_RECEIVED` and `REPLY_PROCESSING_TRIGGERED`.

## R14 Proposal Domain And Approval Gate

R14 introduces Shilabs-owned proposal approval state. Zoho remains the CRM system of
record for lead/deal identity, while PostgreSQL owns proposal drafts, versions, approval
identity/time, sent evidence and audit history.

Only manager/admin approval can move a proposal from `WAITING_APPROVAL` to `APPROVED`.
The internal sent transition requires both approval and an already provider-confirmed
`OutboundEmail` in `SENT` state, so R14 does not fake proposal delivery. Proposal
generation, real sending, Zoho proposal timeline sync, rejection and regeneration remain
later milestones or open client decisions.

## R15 Proposal Generation Agents

R15 generates proposal drafts only. General proposal generation uses persisted lead/deal
context, conversations, qualification and approved knowledge-base entries. SEO proposal
generation adds `SEODataProvider` evidence from SEMrush when configured; missing SEMrush
credentials produce truthful failed generation runs. Web/design generation records missing
brand/design requirements as `NEEDS_INPUT` instead of inventing them.

Generated proposals are created through the R14 proposal workflow and moved to
`WAITING_APPROVAL`. Sending, review UI, Zoho proposal sync and rejection/regeneration are
not part of R15.

## R16 Proposal Review UI

R16 exposes real proposal records inside the lead workspace for manual review. Operators
can view pending proposals, edit draft content, and manager/admin users can approve and
send approved proposals through the API.

Approved proposal sending uses the existing `EmailProvider` path. Shilabs records
provider-confirmed email success first, then appends the proposal-sent activity to Zoho
Bigin through the established timeline connector. Zoho timeline failures remain visible
and retryable on the proposal without resending the already confirmed email.
