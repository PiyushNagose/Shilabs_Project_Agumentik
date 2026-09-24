# Database Scripts

Prisma is configured in `apps/api/prisma/schema.prisma`.

Root scripts:

```bash
npm run db:generate
npm run db:migrate
npm run db:deploy
npm run db:seed
npm run db:reset
```

`db:reset` is for local development only because it drops and recreates database state.

Required environment:

- `DATABASE_URL`
- `DEV_ADMIN_EMAIL`
- `DEV_ADMIN_PASSWORD`
- `BCRYPT_SALT_ROUNDS`

The seed is idempotent for pipeline stages and the development admin user. The development admin password is hashed before storage; do not commit real credentials.

The default local Docker URL is:

```text
postgresql://shilabs:shilabs_dev_password@localhost:5433/shilabs_sales
```

Authentication also requires:

- `JWT_SECRET`
- `JWT_ACCESS_TOKEN_TTL_SECONDS`

M3 adds `Company.normalizedWebsite` for domain-based duplicate detection. New company writes store the normalized domain separately from the submitted website value.

M5 adds `Deal.proposalStatus` with the `DRAFT`, `SENT`, `ACCEPTED` and `DECLINED` values for manual proposal tracking on deals. This is nullable because not every deal has reached proposal handling.

M5 CRM endpoints use pipeline stages from the database. Deal probability defaults from the selected `PipelineStage.probability` unless the API request provides an explicit probability.

M7 adds `Conversation` and `Message`. Conversations link to leads and own communication mode/status. Messages link to conversations, optionally link to a sender user, and keep optional `providerMessageId` unique for future webhook/outbound idempotency. Message `metadata` is the second deliberate JSON use case because provider payload fragments are entity-specific and non-authoritative; core searchable delivery state remains relational columns.

M8 adds `MESSAGE_RECEIVED` and `MESSAGE_SENT` to `ActivityType`. Conversation message writes create one lead activity and refresh `Lead.lastActivityAt` in the same transaction so the simulator thread and CRM activity timeline stay consistent.

M10 adds `LeadQualification` as a one-to-one structured qualification record for a lead,
plus `LeadQualificationEvidence` rows linked to saved `Message` records. Evidence is
relational instead of JSON so quotes can be validated against source conversation messages.
`QUALIFICATION_UPDATED` was added to `ActivityType`; qualification changes create both a
lead activity and an audit event. Score, temperature and pipeline stage remain unchanged in
M10.

M11 adds `ScoringConfig` as the single persisted default scoring rule set. The default
weights are 20 points each for requirement, authority, budget, timeline and business fit.
The default thresholds are 60 for warm and 80 for hot. `SCORE_CHANGED` was added to
`ActivityType`. Lead score recalculation reads only persisted qualification data, updates
`Lead.score` and `Lead.temperature`, and writes activity/audit records transactionally.

R1 adds connector-first integration metadata:

- `IntegrationAccount` stores provider account/configuration state for providers such as
  Zoho Bigin.
- `ExternalRecordMapping` maps local automation records to provider records using stable
  external IDs.

`IntegrationAccount.secretRef` is a reference to an environment variable or secret-store
key, not a plaintext credential value. `publicConfig` is reserved for non-secret provider
configuration such as API domains or region hints. External mappings include sync
direction, sync status, external version/update timestamps, last sync time, retry count,
last error code/message and idempotency key. R1 does not connect to Zoho Bigin or claim a
provider is connected.

R3 adds `IntegrationSyncRun` for run-level Zoho lead/contact synchronization history. Each
run records operation, status, requesting user, start/finish timestamps, record counts and
last error. Per-record identity/sync status remains in `ExternalRecordMapping`.

R4 reuses `IntegrationSyncRun` for `DEAL_SYNC` and reuses `ExternalRecordMapping` for
Zoho deal and activity/timeline mappings. A local `ACTIVITY` mapping is created only after
Zoho returns a successful external timeline record ID.

R5 adds email-provider state:

- `AWS_SES` was added to `IntegrationProvider`.
- `OutboundEmail` persists each outbound email request, idempotency key, provider message
  ID and delivery lifecycle status.
- `EmailSuppression` stores normalized email suppressions from manual or provider feedback
  sources and is checked before any send.
- `EmailProviderEvent` stores idempotent SES delivery/bounce/complaint feedback events.

`EmailProviderEvent.payload` is JSON because SES/SNS event bodies vary by provider event
type and are evidence, not authoritative business state. Queryable send/delivery state
stays in relational columns.

R6 adds `InboundEmail` and expands `EmailProviderEventType` with `INBOUND_RECEIVED`.
`InboundEmail` stores provider message/event IDs, deterministic lead/contact/conversation
mapping, normalized message content, raw provider payload evidence, failure reason when
threading is impossible and pending reply-processing state. Raw inbound payload is JSON
because SES receipt payloads and relay metadata vary; normalized searchable message content
is stored relationally in `Message` and `InboundEmail.textBody`.

R7 adds deliverability/suppression hardening:

- `EmailSuppressionReason.INVALID` represents malformed persisted addresses identified by
  server-side validation or scan checks.
- `EmailDeliverabilityScan` stores durable scan runs with contactability counts, requester,
  timestamps and failure visibility.

`EmailDeliverabilityScan` is intentionally aggregate state rather than one row per contact
result. Contact-level hard blocks remain represented by `EmailSuppression`,
`Contact.doNotContact` and terminal lead status. A later worker can schedule the same scan
service without changing the database ownership model.

R8 adapts the old M11 scoring work to the revised product direction:

- `LeadScoreRun` records each deterministic rule-engine calculation or human score override.
- Rule-engine runs snapshot factors, scoring config and persisted qualification/evidence.
- Manual overrides are preserved with `Lead.scoreOverrideAt`, `Lead.scoreOverrideByUserId`
  and `Lead.scoreOverrideReason`.

When a manual override is active, automatic recalculation records a skipped
`LeadScoreRun` instead of overwriting the human-owned score. Scores remain local
automation/operator-prioritization state and do not drive Zoho Bigin pipeline state without
an explicit future business rule.

R9 adds governed knowledge-base storage:

- `KnowledgeBaseEntry` stores the stable key, category, active/inactive approval state and
  active version pointer.
- `KnowledgeBaseVersion` stores immutable content versions, source title/type/url,
  approval identity/time and correction lineage.

Only `APPROVED` entries with an active approved version should be used by AI/proposal
features. Corrections create new versions instead of overwriting prior content, preserving
human-owned correction history and auditability.

R10 adds `ReplyProcessingRun` for inbound reply understanding. Each run links to the lead,
conversation, message and optional inbound email, and stores:

- structured intent/action output
- draft response text when allowed
- provider/model metadata
- input context and output JSON evidence
- failure code/message when AI/config/validation fails

Reply processing never records provider delivery success. It may update local conversation
control state for `NOT_INTERESTED`/`NEGOTIATION` style outcomes, but sending, follow-up
scheduling, proposal approval and meeting creation remain later milestones.

R11 adds `DomainEventOutbox` plus `DomainEventStatus` and `DomainEventPriority`.
The outbox is the durable boundary between committed application facts and later worker
execution. Each row stores:

- event type and aggregate identity
- JSON payload evidence for the fact being handed off
- correlation and unique idempotency keys
- status, priority, attempt count, lock state and retry timing
- processed/failed timestamps and actionable failure details
- optional operator retry requester

`DomainEventOutbox.payload` is JSON because event payloads are immutable fact envelopes
whose shape varies by event type. Searchable operational state remains in relational
columns. R11 intentionally does not add Redis/BullMQ dispatch, external provider sends or
successful Zoho timeline writes.

R12 extends `DomainEventOutbox` with queue lifecycle fields:

- `QUEUED` and `ATTENTION_REQUIRED` statuses
- queue name/job ID and queued timestamp
- dead-letter/attention timestamp

The worker moves due `PENDING` events into BullMQ jobs with stable job IDs, marks them
`QUEUED`, transitions them to `PROCESSING` only when a matching job executes, and then
records `PROCESSED`, retryable `PENDING`, or `ATTENTION_REQUIRED` state. Stale
queued/processing rows are recoverable from PostgreSQL; Redis is not treated as the sole
source of truth.

R13 adds follow-up automation state:

- `FollowUpSequence` stores the active/stopped/completed state for a lead's first-email
  and follow-up cadence.
- `FollowUpAttempt` stores each scheduled first email or Day 1/5/9 follow-up, including
  persisted subject/body, idempotency key, linked outbound email, send status and Zoho
  timeline sync status.

The default cadence is `[0, 1, 5, 9]` days. Attempts are driven by `DomainEventOutbox`
events and BullMQ delivery, but PostgreSQL remains the lifecycle source of truth. Inbound
email replies cancel pending scheduled attempts before later follow-up communication can
execute.

R14 adds the local proposal workflow:

- `Proposal` stores proposal identity, lead/deal linkage, current status and approval/send
  evidence.
- `ProposalVersion` stores immutable draft/edit versions so human edits are auditable.
- `ProposalStatusChange` stores append-style status transition history.

Proposal statuses are `DRAFT`, `WAITING_APPROVAL`, `APPROVED` and `SENT`. The application
must not record `SENT` unless the proposal is approved and a provider-confirmed sent
`OutboundEmail` already exists. Proposal generation, provider sending and rejection or
regeneration workflows remain later milestones/open client decisions.

R15 adds `ProposalGenerationRun` for proposal-generation evidence and failure visibility.
Each run records the requested generation kind, actor, lead/deal, approved knowledge
evidence, optional tool evidence such as SEMrush output, AI output, missing web/design
fields and failure details. Evidence fields are JSON because AI/tool evidence differs by
proposal agent, while searchable lifecycle state remains relational.

Generated proposals are persisted through the R14 proposal workflow and moved to
`WAITING_APPROVAL`; R15 does not send proposals.

R16 adds proposal send synchronization state on `Proposal`:

- `zohoTimelineSyncStatus` records whether the provider-confirmed proposal send still
  needs CRM timeline synchronization, has synced, failed, or is not configured.
- `zohoTimelineLastError` stores the latest visible Zoho timeline sync failure.

The proposal is marked `SENT` only after `OutboundEmail.status` is `SENT`. Zoho timeline
sync happens after that confirmed local sent state and is retryable without resending the
email.

R26 adds `BriefingRun` for lead and meeting briefing evidence:

- `kind` distinguishes lead briefings from meeting briefings.
- `leadId` is required; `meetingRequestId` is nullable for lead-level briefings.
- `inputContext`, `evidence`, `approvedKnowledge` and `output` are JSON because each
  advisory briefing may cite different persisted sources and approved-KB entries.
- `summary`, `recommendedNextAction`, status, provider/model and failure columns keep the
  latest operational result queryable.

Briefing runs are advisory evidence only. They do not update CRM state, meeting state,
proposal state, automation schedules, approvals or external provider state.

R27 extends `InternalNotification` for in-app notification lifecycle state:

- `status` now includes `ACKNOWLEDGED` and `ESCALATED`.
- `escalationStatus` records whether escalation evidence is none, pending or escalated.
- `readByUserId`, `acknowledgedByUserId`, `escalatedByUserId` and matching timestamps
  capture who moved the notification through the lifecycle.
- `escalationDueAt`, `escalationReason` and `escalationEvidence` persist in-app
  escalation context without implying an external channel was contacted.

The existing `idempotencyKey` remains the duplicate-prevention boundary for source events.
Lifecycle transitions are append-evidenced through audit events and domain events.
