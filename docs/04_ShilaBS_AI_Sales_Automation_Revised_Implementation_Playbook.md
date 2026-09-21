# Shilabs AI Sales Automation - Revised Module-by-Module Implementation Playbook

## Governing Rules
1. The client meeting is the current source of truth; earlier ideation is secondary when conflicts exist.
2. Connector-first: Zoho Bigin remains the Phase 1 CRM.
3. Preserve useful M0-M10 work; adapt CRM-like modules instead of deleting them.
4. Production-ready only. No mock/demo runtime data.
5. Codex works one milestone at a time and stops for review.
6. Do not invent unresolved client decisions. Add feature flags/config placeholders only where necessary and keep unsafe actions disabled.
7. Every milestone runs type-check, lint, relevant tests, full tests when feasible, and build. Database changes require migration verification.

# A. Reconciliation Gate

## R0 - Existing Code Audit Against Revised Requirements
**Goal:** make the repository understand the new connector-first product before adding features.

Tasks:
- Audit M0-M10 against the revised SRS and technical architecture.
- Identify standalone-CRM assumptions in schema/services/UI.
- Do not delete working data models. Classify each as local automation state, synchronized CRM representation, or internal-only data.
- Add/update architecture documentation and ADR for `Zoho Bigin = CRM system of record`.
- Confirm simulator/dev fixtures cannot leak into production runtime.
- Produce migration impact plan, not destructive migration unless explicitly required.

DoD: repository documentation, boundaries and next migrations align with connector-first architecture; all existing tests remain green.

# B. Connector & Real Data Foundation

## R1 - CRM Provider Abstraction + Integration Mapping
- Add provider-neutral `CRMProvider` contract.
- Add integration account/config model without storing plaintext secrets.
- Add external record mapping/sync status model.
- Add idempotency and sync-error metadata.
- Implement no fake production provider. Tests use explicit test doubles only.

## R2 - Zoho Bigin Authentication & Connectivity
- Implement real Zoho Bigin OAuth/API authentication using client-provided credentials/configuration.
- Token refresh, scope validation, connection health endpoint, secure error handling.
- If credentials are not yet available, code may be complete but runtime status must truthfully report `NOT_CONFIGURED`; never return fake connected state.

## R3 - Zoho Lead/Contact Sync
- Import/map real leads/contacts required for automation.
- Upsert and deduplicate using external IDs.
- Handle webhook/poll strategy according to Bigin capability.
- Persist sync status and failures.
- Reconcile existing Company/Contact/Lead models as local synchronized representations.

## R4 - Zoho Deal/Timeline Sync
- Map deal/pipeline representation.
- Append material activities/messages/proposal/meeting events to Zoho timeline where API permits.
- Add conflict/idempotency tests.

# C. Email Foundation

## R5 - AWS SES Provider
- Implement `EmailProvider` abstraction and real AWS SES adapter.
- Sending identity/config validation.
- Persist outbound email request/provider ID/status.
- Bounce/complaint/delivery event ingestion.
- No send if address is suppressed or automation state forbids outreach.

## R6 - Inbound Email / Reply Ingestion
- Implement the approved inbound email path once channel is confirmed.
- Thread messages to the correct lead/conversation.
- Persist raw provider metadata safely and normalized message content.
- Trigger reply processing event.

## R7 - Email Deliverability & Suppression
- Pre-send validation strategy.
- SES bounce/complaint suppression.
- Periodic health scan architecture.
- Server-side hard block for suppressed addresses.

# D. AI Sales Context

## R8 - Lead Scoring (Revised M11)
- Continue deterministic scoring only if it is useful to automation/operator prioritization.
- Score must be explainable and server-owned.
- Do not make Zoho pipeline state depend on AI score unless a business rule explicitly maps it.

## R9 - Knowledge Base Governance (Revised M12)
- Approved company/service/proposal knowledge only.
- Versioning, source metadata, active/inactive state and human correction.
- Retrieval must be traceable.
- No unapproved invented case studies/prices/claims.

## R10 - Reply Understanding & Response Engine
- Detect intent: interested, not interested, proposal request, meeting request, negotiation, question, unclear.
- Use M7 messages + M10 qualification + approved KB.
- Server validates action.
- `No` stops prohibited outreach immediately.
- Negotiation triggers human handoff, not autonomous negotiation.

# E. Durable Automation

## R11 - Domain Event Foundation
- Formalize domain events/outbox or equivalent reliable event handoff.
- Correlation/idempotency keys.
- Ensure events are persisted before external side effects.

## R12 - Worker/Queue Hardening
- Redis/BullMQ durable execution.
- Retries/backoff, dead-letter/attention state, job deduplication.
- Worker revalidates current lead state before every send/call/message.

## R13 - Follow-up Engine
- First email automation and Day 1/5/9 follow-up schedule from current requirement.
- Per-lead schedule persisted; survives restart/deploy.
- Stop/pause on response, No, suppression, human takeover or incompatible state.
- No duplicate sends under retries/concurrency.

# F. Proposal Workflow

## R14 - Proposal Domain + Approval Gate
- Proposal entity/version/edit history/status.
- Draft -> Waiting for Approval -> Approved -> Sent.
- Server-enforced rule: cannot send without human approval.
- Rejection/regeneration behavior remains disabled until clarified, unless client confirms it.

## R15 - Proposal Generation Agents
- General technical proposal generation.
- SEO proposal with `SEODataProvider`/SEMrush.
- Web/design proposal flow asks for missing brand/design requirements before generating final proposal.
- Store source/tool evidence used for generation.

## R16 - Proposal Review UI
- Real pending proposals.
- View/edit/approve.
- Approval identity/time/version recorded.
- Approved proposal send uses real EmailProvider and syncs result to Zoho.

# G. Human Handoff & Operator UX

## R17 - Human Takeover
- Explicit takeover state and authorized action.
- Pause conflicting automation.
- Full briefing: requirements, conversation summary, qualification, proposal/deal context, latest actions.
- Resume policy only after client rule is finalized.

## R18 - Negotiation Detection & Handoff
- Detect negotiation intent.
- Notify assigned engineer/account owner.
- AI may summarize but must not autonomously negotiate.

## R19 - Sales Engineer Action Dashboard
- Pending proposal approvals.
- Appointments/meetings.
- Negotiation/takeover alerts.
- Failures requiring attention.
- Keep follow-up machinery out of the primary dashboard; detailed history remains accessible.

# H. Meetings

## R20 - Calendar Provider + Availability
- Provider-neutral CalendarProvider.
- Real calendar integration after provider/account details are confirmed.
- Timezone-safe availability.

## R21 - Meeting Scheduling & Confirmation
- Propose slots, persist request, confirm according to finalized client rule, create provider meeting, sync to Zoho, notify parties.
- No fake availability.

# I. Calling & WhatsApp

## R22 - Voice Provider Foundation
- Provider abstraction and selected real paid provider.
- Outbound call, call status, recording/transcript metadata as legally/configurably permitted.
- Regional voice/accent selection.
- Compliance/consent configuration must be explicit before production enablement.

## R23 - Calling Automation
- Trigger after failed email sequence.
- Retry requirement: two attempts in the configured day, then wait three days, then another attempt (subject to final business confirmation).
- Persist each attempt/outcome.
- Voicemail behavior remains gated until clarified.

## R24 - WhatsApp Provider + Messaging
- Real WhatsApp Business integration/provider.
- Approved templates where required.
- Send alongside configured call attempts.
- Persist delivery/read/reply status and sync material events to Zoho.

# J. Training, Feedback & Intelligence

## R25 - Agent Feedback/Correction Store
- Persist human corrections with agent, context, previous output and corrected outcome.
- Version training/knowledge changes.
- Do not claim model fine-tuning unless an actual training/fine-tuning pipeline is implemented.

## R26 - Lead/Meeting Briefings
- Generate grounded briefing from persisted evidence and approved knowledge.
- Include requirements, budget/timeline if known, decision context, recent communication and recommended next action.

# K. Operations & Production Hardening

## R27 - Notifications
- Internal notification model first.
- Add real email/mobile/push channel only after client confirms channels.
- Deduplication, read/acknowledged state and escalation.

## R28 - Integration Health & Cost Visibility
- Zoho, SES, OpenAI, SEMrush, WhatsApp, voice and calendar health/config status.
- Failed/queued jobs, unsynced records, provider errors.
- Token/email/call usage and cost indicators where provider data permits.

## R29 - Security & Compliance Hardening
- Secret handling, RBAC review, audit review, webhook verification, rate limiting, security headers, input limits, retention policies, PII review.
- Calling/email/WhatsApp consent and geographic compliance review before production activation.

## R30 - End-to-End Production Validation
Test with controlled real integrations and authorized real/test-recipient accounts:
1. Zoho lead sync.
2. First email.
3. Follow-up scheduling.
4. Inbound reply.
5. AI intent/context update.
6. Proposal generation.
7. Human approval.
8. Proposal send.
9. Human negotiation handoff.
10. Meeting scheduling.
11. CRM timeline sync.
12. Failure/retry/idempotency scenarios.

# L. Phase 2 Hook
## R31 - Hunter / Cold Outreach (Deferred)
Do not implement in Phase 1. Keep only clean interfaces/events that allow a future hunter system to hand qualified leads into the sales automation engine. Hunter must use separate high-volume sending infrastructure.

# Standard Codex Milestone Report
```text
MILESTONE:
STATUS:
IMPLEMENTED:
REUSED:
FILES CREATED:
FILES MODIFIED:
DATABASE CHANGES:
API CHANGES:
INTEGRATION CHANGES:
TESTS ADDED:
COMMANDS RUN:
RESULTS:
DEFINITION OF DONE:
PRODUCTION-READINESS CHECK:
ASSUMPTIONS:
RISKS / OPEN ITEMS:
ARCHITECTURE NOTES:
SUGGESTED COMMIT:
NEXT RECOMMENDED MILESTONE:
STOP.
```

# Immediate Next Step
Do **R0** next. Do not continue the old M11 blindly. After R0 is reviewed, proceed to R1 and build the connector foundation before adding further CRM-like functionality.
