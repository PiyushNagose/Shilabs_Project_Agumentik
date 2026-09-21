# R0 Revised Requirements Audit

## Scope

R0 audits the current M0-M10 implementation against the revised client requirements. No runtime functionality is added, removed or rewritten in this milestone.

The four revised documents are authoritative:

- `docs/01_ShilaBS_AI_Sales_Automation_Final_Revised_SRS.docx`
- `docs/02_ShilaBS_AI_Sales_Automation_System_Flow_and_Agent_Architecture.docx`
- `docs/03_ShilaBS_AI_Sales_Automation_Technical_Architecture_and_Data_Ownership.md`
- `docs/04_ShilaBS_AI_Sales_Automation_Revised_Implementation_Playbook.md`

## Revised Product Boundary

Shilabs is now an AI sales automation and orchestration layer, not a standalone CRM replacement. Zoho Bigin is the CRM system of record for CRM lead/contact/deal identity, CRM pipeline state and CRM timeline representation.

PostgreSQL remains authoritative for Shilabs-owned state: automation state, qualification/evidence, follow-up state, proposal approval workflow, integration mappings, retries, sync metadata, audit/history and operator dashboard context.

External integrations must be real providers or explicit development adapters that fail truthfully when not configured. Test fixtures are allowed only in automated tests.

## Existing Functionality Classification

| Area                             | Classification             | Revised Ownership                                             | Audit Notes                                                                                                                                                   |
| -------------------------------- | -------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M0 monorepo/workspace            | KEEP                       | Internal platform                                             | Apps, packages, Docker, TypeScript, lint/test/build structure still fits the revised modular monolith.                                                        |
| M1 PostgreSQL/Prisma foundation  | ADAPT                      | Local orchestration state                                     | PostgreSQL stays, but schema docs must stop calling it the CRM source of truth. Add integration mapping/sync metadata in R1.                                  |
| M2 auth/RBAC/users               | KEEP                       | Internal-only                                                 | Needed for operators, approvals, admin settings and audit attribution. Later roles/permissions may expand for proposal approval and takeover.                 |
| M3 companies/contacts            | ADAPT                      | Synchronized CRM representation                               | Useful local context, but production identity must map to Zoho Bigin records. Duplicate logic should prefer external IDs once available.                      |
| M4 leads                         | ADAPT                      | Local automation context plus synchronized CRM representation | Existing lead APIs are useful, but local lead state must not compete with Zoho lead/deal state.                                                               |
| M5 pipeline/deals                | ADAPT                      | Synchronized CRM representation                               | Activities/audit stay local. Pipeline/deal records need Zoho mapping and sync policy before production CRM authority.                                         |
| M5 activities/audit              | KEEP                       | Internal-only                                                 | Append-style activity and audit history support orchestration and accountability. Material CRM events should later sync to Zoho timeline.                     |
| M6 frontend CRM workspace        | ADAPT / DEPRIORITIZE       | Operator UX                                                   | Reuse components and real API plumbing, but reposition UX toward sales engineer actions, approvals, meetings, alerts and context rather than CRM replacement. |
| M7 conversations/messages        | KEEP / ADAPT               | Local evidence and messaging state                            | Good foundation for reply understanding and evidence. Add provider-specific delivery/sync mapping later.                                                      |
| M8 internal simulator            | DEPRIORITIZE               | Development-only                                              | Useful for local manual testing, but must be gated as internal/dev-only and must never pretend external delivery occurred.                                    |
| M9 AI provider abstraction       | KEEP / ADAPT               | Provider boundary                                             | Good abstraction. Gemini can remain a development-cost adapter; production provider/config must be explicit and fail truthfully when missing.                 |
| M10 qualification/evidence       | KEEP / ADAPT               | Shilabs-owned automation state                                | Fits revised ownership. Later knowledge governance and Zoho summary sync are needed.                                                                          |
| Old M11 scoring work in worktree | DEPRIORITIZE / ADAPT LATER | Shilabs-owned scoring state                                   | Revised playbook moves scoring to R8. Do not extend it now; revisit after CRM/email/deliverability foundations.                                               |

## Standalone CRM Assumptions Found

- `docs/architecture/README.md` previously described PostgreSQL as source of truth for CRM/pipeline state.
- `docs/decisions/ADR-001-database-foundation.md` says CRM, pipeline, workflow state, scoring, scheduling, analytics and audit history remain in-house; this now conflicts for CRM/pipeline ownership.
- API modules expose local CRUD for companies, contacts, leads, deals and pipeline stages without Zoho external record mapping.
- `apps/web/src/features/leads/CrmWorkspace.tsx` and navigation labels present the first UI as a CRM workspace.
- `PipelineStage`, `Deal` and lead stage transitions currently behave as local authoritative state.
- `Message.providerMessageId` exists, but there is no general external record mapping, provider account model, sync status or retry/error model.

## Missing Architecture Items For Revised Requirements

- Provider-neutral `CRMProvider` contract.
- `ZohoBiginProvider` implementation and configuration.
- External record mapping for synchronized CRM entities.
- Sync state, direction, external modified time/version, retry count, last error and idempotency fields.
- Zoho webhook or polling strategy.
- AWS SES `EmailProvider`.
- Inbound email ingestion and reply correlation.
- Deliverability, unsubscribe and suppression model.
- Domain event/outbox foundation before irreversible side effects.
- Durable BullMQ workers for external sync and follow-up actions.
- Proposal approval domain and human approval gate.
- Sales engineer action dashboard.
- Calendar, voice, WhatsApp and SEMrush provider boundaries.
- Integration health, failed sync and cost/usage visibility.

## Contradictions And Safest Interpretation

| Conflict                                                                                                                           | Impact                                                                 | Safest Interpretation                                                                                                                        |
| ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Old docs: Shilabs PostgreSQL is CRM source of truth. Revised docs: Zoho Bigin is CRM system of record.                             | Current CRM-like models/APIs can diverge from Zoho in production.      | Keep models as local synchronized representations/automation context and add Zoho mapping/sync before treating them as production CRM state. |
| Old milestone order reached scoring as M11. Revised playbook says stop old M11 and do R0, then R1-R7 before revised scoring at R8. | Scoring work exists too early relative to connector/email foundations. | Do not remove it now, but do not extend or rely on it until R8 realignment.                                                                  |
| Existing UI says CRM workspace. Revised product is automation/operator UX around Zoho.                                             | Manual testers may think Shilabs replaces Zoho.                        | Reuse UI plumbing but rename/reframe screens in a later approved milestone.                                                                  |
| Existing simulator writes real local messages. Revised docs prohibit mock/demo runtime actions.                                    | Simulator can be mistaken for real external messaging.                 | Keep only as explicit development/internal testing tool; production must route through real providers or fail.                               |

## Recommended Realignment Actions

1. R1: add provider-neutral `CRMProvider` contracts and integration mapping tables before any Zoho-specific business logic.
2. R1: model external record mappings with provider, entity type, local ID, external ID, sync direction/status, timestamps, last error, retry count and idempotency/dedup keys.
3. R2: implement real Zoho Bigin auth/connectivity with configuration validation and truthful failure states.
4. R3-R4: sync Zoho leads, contacts, deals and timeline events, then adapt local CRUD semantics to prevent silent divergence.
5. Reframe frontend CRM workspace toward operator automation: action queue, approvals, replies, meetings, failed syncs and lead context.
6. Gate or clearly label the internal simulator as development-only before production use.
7. Update ADR-001 later or supersede it where it claims CRM/pipeline are in-house systems of record.
8. Delay additional scoring work until R8 and ensure score does not directly change Zoho pipeline unless a business rule explicitly maps it.

## Production-Readiness Check

- No runtime mock provider fallback was found in AI configuration; tests use test-only mocks.
- The simulator uses persisted local data, but it is not yet protected by an explicit production feature gate.
- Existing external provider work is limited to AI adapters. No Zoho, SES, WhatsApp, voice, calendar or SEMrush integration has been implemented yet.
- No destructive migration is recommended in R0.
- Current `.env` may contain real credentials and must remain uncommitted.

## R0 Outcome

R0 is a documentation and alignment milestone. The next approved milestone should be R1: CRM Provider Abstraction + Integration Mapping.
