# Shilabs AI Sales Automation - Technical Architecture & Data Ownership

## 1. Status
This document supersedes the earlier assumption that Phase 1 is a standalone CRM. The current client requirement is **connector-first**: Zoho Bigin remains the CRM system of record, while Shilabs provides AI automation, orchestration, integration, reliability, audit, and operator UX.

## 2. Production Rule
- Production-ready implementation only.
- No mock/demo business data in runtime paths.
- Automated tests may use isolated fixtures.
- Real provider integrations must be behind interfaces/adapters and must fail safely when credentials/configuration are unavailable.
- No fake-success provider implementations in production mode.

## 3. Recommended Runtime Topology
```text
apps/web        Sales engineer/operator UI
apps/api        Auth, domain APIs, connector endpoints, webhooks
apps/worker     Durable jobs, automation execution, provider sync
PostgreSQL      Automation state, mappings, evidence, approvals, audit
Redis/BullMQ    Durable queues, delays, retries, scheduled work
Zoho Bigin      CRM system of record
AWS SES         Transactional email
OpenAI          LLM via AIProvider abstraction
SEMrush         SEO proposal input
WhatsApp        Messaging provider (TBD)
Voice Provider  AI calling/accent/voicemail (TBD)
Calendar        Availability/meeting provider (TBD)
```

## 4. Data Ownership Matrix
| Domain | Source of truth | Local storage rule |
|---|---|---|
| CRM lead/contact/deal identity | Zoho Bigin | Store external IDs + automation-required snapshot/context |
| Pipeline/timeline CRM representation | Zoho Bigin | Cache/sync only as required for automation and UX |
| Automation state | Shilabs | Authoritative locally |
| Job execution/retries | Shilabs | Authoritative locally |
| AI qualification/evidence | Shilabs | Authoritative locally; may summarize to Zoho |
| Proposal draft/edit/approval | Shilabs workflow | Sync final/material state to Zoho |
| Message/call history | Provider + Shilabs evidence | Persist required content/status and sync timeline |
| Suppression/deliverability | Shilabs + provider feedback | Must block sends server-side |
| Audit | Shilabs | Immutable/append-oriented audit history |
| Meeting | Calendar provider + CRM | Store orchestration mapping/status locally |

## 5. Connector Architecture
Create a provider-neutral CRM connector boundary, for example:
```ts
interface CRMProvider {
  pullLead(externalId: string): Promise<CRMLead>;
  upsertLead(input: CRMLeadUpsert): Promise<ExternalRecordRef>;
  upsertContact(input: CRMContactUpsert): Promise<ExternalRecordRef>;
  upsertDeal(input: CRMDealUpsert): Promise<ExternalRecordRef>;
  appendTimelineEvent(input: CRMTimelineEvent): Promise<ExternalRecordRef>;
  upsertMeeting(input: CRMMeetingUpsert): Promise<ExternalRecordRef>;
  verifyWebhook(input: WebhookRequest): Promise<VerifiedWebhook>;
}
```
First implementation: `ZohoBiginProvider`. Do not spread Zoho-specific SDK/types through domain services.

### Required connector metadata
- provider
- entity type
- local entity ID
- external record ID
- external version/modified time when available
- last synced at
- sync direction
- sync status
- last error
- retry count
- idempotency/deduplication key

## 6. Event and Automation Model
Domain events should drive automation, not controllers directly calling multiple providers. Examples:
- `lead.synced`
- `lead.created`
- `email.sent` / `email.delivered` / `email.bounced`
- `message.received`
- `followup.due`
- `call.completed`
- `proposal.generated`
- `proposal.approved`
- `negotiation.detected`
- `meeting.requested` / `meeting.confirmed`
- `human.takeover.started` / `human.takeover.ended`

Worker execution must re-check current state immediately before side effects to prevent stale jobs from sending after a No, suppression, approval-state change, or human takeover.

## 7. Provider Boundaries
- `AIProvider`: OpenAI first; structured schemas; no direct state mutation.
- `EmailProvider`: AWS SES first; delivery/bounce event handling.
- `CRMProvider`: Zoho Bigin first.
- `MessagingProvider`: WhatsApp implementation TBD.
- `VoiceProvider`: paid voice/calling implementation TBD.
- `CalendarProvider`: provider TBD.
- `SEODataProvider`: SEMrush.

## 8. Security & Reliability
- Server-side RBAC for every sensitive action.
- Encrypt provider credentials/secrets at rest where stored; prefer secret manager/environment injection.
- Webhook signature verification and replay protection.
- Idempotent side effects and deduplication.
- Transactional persistence before enqueueing external work.
- Retry/backoff with permanent-vs-transient error classification.
- Dead-letter/attention queue and safe manual replay.
- Correlation IDs across API -> job -> provider -> CRM sync.
- Rate-limit awareness for Zoho, SES, OpenAI, WhatsApp, voice, SEMrush and calendar APIs.
- Audit human approvals, edits, takeover, send actions, suppression changes and provider sync outcomes.
- Operational dashboard must expose provider health, failed jobs, unsynced CRM records and daily usage/cost indicators.

## 9. Reconciliation of M0-M10
| Existing milestone | Decision | Revised role |
|---|---|---|
| M0 Repository | KEEP | Monorepo foundation remains valid |
| M1 Database | KEEP + ADAPT | DB remains required for automation state; add integration mappings/sync metadata |
| M2 Auth/RBAC | KEEP | Required for operator/human approval access |
| M3 Companies/Contacts | ADAPT | Treat as synchronized/local automation representation, not standalone CRM master |
| M4 Leads | ADAPT | Local automation context mapped to Zoho lead/contact records |
| M5 Pipeline/Deals/Activities/Audit | ADAPT | Activities/audit stay local; deal/pipeline data syncs with Zoho rather than competing with it |
| M6 Frontend CRM Foundation | ADAPT/DEPRIORITIZE | Retain useful components; engineer UI should focus on actions, context, approvals, meetings, alerts |
| M7 Conversations/Messages | KEEP | Core evidence/context and CRM timeline sync source |
| M8 Conversation Simulator | TEST/DEV ONLY | Must never act as production business data or provider path |
| M9 AI Provider | KEEP | Correct abstraction; OpenAI is current provider |
| M10 Qualification | KEEP | Useful structured context; may inform automation/proposals and summaries |

## 10. Do Not Implement Until Clarified
Voicemail semantics; No reactivation; hibernate retirement; duplicate human/AI send arbitration; manual takeover resume policy; proposal rejection/regeneration; exact KB governance; WhatsApp provider; meeting confirmer; notification channels; per-lead agent priority/concurrency; SES-vs-Outlook routing; calling consent/compliance scope.

## 11. Architectural Definition of Done
A feature is not production-ready merely because its API works. It must have persistence, validation, authorization, auditability, idempotency where relevant, failure handling, observability, tests, and real-provider configuration boundaries.
