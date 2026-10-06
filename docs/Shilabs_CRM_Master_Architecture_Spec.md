# Shilabs CRM — Master Architecture & Implementation Specification

**Status:** Architecture baseline for Codex implementation  
**Date:** 2026-10-06  
**Purpose:** Define the target architecture, migration strategy, product structure, engineering principles, and implementation constraints for evolving the existing Shilabs sales-automation platform into a complete, production-grade, AI-native CRM.

---

## 1. Executive Summary

Shilabs is evolving from a lead-centered sales-automation system into a complete CRM platform.

The new platform must preserve and reuse the strongest parts of the existing system while introducing the missing CRM foundations required for a robust real-world product.

The platform must satisfy four non-negotiable goals:

1. **Reusability**
   - Shared domain models.
   - Shared UI primitives.
   - Reusable workflow nodes and agent capabilities.
   - Reuse existing provider, AI, proposal, meeting, event, and communication foundations.
   - Avoid duplicate implementations.

2. **Robustness**
   - Tenant isolation.
   - Granular RBAC.
   - Idempotent event processing.
   - Safe retries.
   - Strong auditability.
   - Security hardening.
   - Explicit failure states.
   - Versioned workflows/agents.
   - CI/E2E gates.

3. **Pixel-perfectness**
   - Reference images are visual acceptance targets.
   - The UI must be implemented as a reusable design system, not independent page-specific CSS.
   - Visual consistency must be reproducibly tested.

4. **Full end-to-end correctness**
   - Every visible action must work through the complete stack.
   - UI, API, database, workers, integrations, AI, realtime, permissions, audit, and failure handling must stay synchronized.

The client team already uses Zoho Bigin. The new CRM must therefore preserve a familiar CRM mental model while presenting a cleaner, modern, AI-native interface.

The new platform is **not a clone of Zoho Bigin**, but users should immediately understand the concepts:
- Leads
- Contacts
- Companies
- Deals
- Pipelines
- Activities
- Tasks
- Calls
- Emails
- Meetings
- Proposals
- Orders
- Owners
- Stages
- Next actions

---

## 2. Current-State Baseline

The existing system already contains strong foundations that must be preserved.

### 2.1 Existing reusable foundations

Reuse and extend:
- Leads
- Contacts
- Companies
- Deals
- Pipeline stages
- Conversations/messages
- Email persistence and provider attempts
- WhatsApp persistence/provider handling
- Calling sequences and voice attempts
- Qualification/scoring/evidence
- AI provider abstraction
- Reply processing
- Proposal generation/versioning/approval
- Meeting request/slot/calendar sync
- Domain event outbox
- BullMQ worker infrastructure
- Suppression / DNC handling
- Human takeover
- Realtime invalidation
- Auth sessions
- Existing operational dashboards where useful

### 2.2 Existing capabilities that must not be duplicated

Do **not** create parallel systems for:
- Proposal versioning and approval.
- Provider operation records.
- Meeting slots.
- Reply-processing evidence.
- Scoring runs.
- Suppression handling.
- Domain-event persistence.
- Existing communication histories.
- Existing AI provider abstraction where extension is sufficient.

### 2.3 Confirmed missing foundations

The current platform lacks:
- Workspace / organization tenancy.
- Membership model.
- Granular permissions.
- Task entity.
- Order entity.
- Configurable workflows.
- Workflow executions.
- Configurable AI agents.
- Agent executions.
- Structured unified timeline.
- Enterprise-grade audit correlation.
- Production observability.
- Visual regression CI.
- Strong frontend modularity.

These are foundational requirements, not optional enhancements.

---

## 3. Product Architecture

The CRM must be organized around one shared domain model.

### 3.1 Top-level entity hierarchy

```text
Workspace
 ├── Members / Users / Roles / Permissions
 ├── Companies
 │    ├── Contacts
 │    ├── Leads
 │    ├── Deals
 │    ├── Orders
 │    ├── Activities
 │    ├── Tasks
 │    └── Files / Notes
 ├── Contacts
 │    ├── Leads
 │    ├── Deals
 │    ├── Conversations
 │    ├── Meetings
 │    ├── Tasks
 │    └── Activities
 ├── Leads
 │    ├── Qualification
 │    ├── Conversations
 │    ├── Tasks
 │    ├── Meetings
 │    ├── Proposals
 │    ├── Calls
 │    ├── Follow-ups
 │    ├── Deals
 │    ├── Activities
 │    └── Automation state
 ├── Deals
 │    ├── Stage
 │    ├── Value
 │    ├── Proposals
 │    ├── Meetings
 │    ├── Tasks
 │    ├── Activities
 │    └── Orders
 ├── Orders
 │    ├── Items
 │    ├── Payment state
 │    ├── Fulfillment state
 │    └── Activities
 ├── Workflows
 ├── Agents
 ├── Integrations
 ├── Audit / Executions
 └── Analytics / AI Intelligence
```

### 3.2 Domain principles

- A **Company** is an organization/account.
- A **Contact** is a person.
- A **Lead** is a sales opportunity/prospect record, not the same thing as a person or company.
- A **Deal** is a commercial opportunity.
- An **Order** is a post-deal commercial/fulfillment record.
- A **Task** is a durable user/system action item.
- An **Activity** is a structured timeline event.
- A **Conversation** contains channel-specific messages.
- An **Agent** defines reusable AI behavior.
- A **Workflow** orchestrates business automation across records and actions.
- A **Pipeline** defines business stages and progression rules.
- An **Execution** records a workflow/agent run.
- An **Audit record** records who/what changed something and when.

---

## 4. Tenancy and Workspace Architecture

This is a prerequisite for full CRM expansion.

### 4.1 Workspace model

Introduce:
- `Workspace`
- `WorkspaceMember`
- `WorkspaceRole`
- `Permission`
- optional `Team`

Every business record must belong to exactly one workspace.

Examples:
- Lead.workspaceId
- Contact.workspaceId
- Company.workspaceId
- Deal.workspaceId
- Order.workspaceId
- Task.workspaceId
- Workflow.workspaceId
- Agent.workspaceId
- Integration.workspaceId

### 4.2 Tenant isolation rule

No business query may operate without workspace scope.

Required invariant:

```text
Authenticated session
→ workspace membership resolved
→ workspaceId injected into authorization context
→ every repository/service query filtered by workspaceId
```

Do not rely on frontend filtering.

### 4.3 Membership model

A user may belong to multiple workspaces.

Workspace membership should contain:
- role
- status
- joinedAt
- invitedBy
- team membership
- permissions / overrides if supported later

---

## 5. RBAC and Authorization

The current static role enum is insufficient.

### 5.1 Recommended role baseline

Default system roles:
- Owner
- Admin
- Sales Manager
- Sales Representative
- Operations
- Viewer

### 5.2 Permission categories

Examples:
- leads.read
- leads.create
- leads.update
- leads.delete
- leads.assign
- contacts.*
- companies.*
- deals.*
- orders.*
- tasks.*
- proposals.approve
- workflows.manage
- agents.manage
- integrations.manage
- members.manage
- audit.read
- analytics.read
- communications.send
- voice.call
- meetings.manage

### 5.3 Object-level authorization

Every nested resource must inherit/check access to its parent.

Examples:
- deal access must check workspace + record scope
- conversation access must check related lead/contact/company access
- proposal access must check deal/lead scope
- meeting access must check related CRM record

Authorization must be centralized in reusable policy helpers.

---

## 6. Unified Activity and Timeline Model

The existing free-text Activity model must evolve into a structured timeline.

### 6.1 Structured Activity

Recommended fields:
- id
- workspaceId
- entityType
- entityId
- activityType
- actorType
- actorUserId
- actorAgentId
- sourceType
- sourceId
- title
- summary
- metadata JSON
- occurredAt
- createdAt
- correlationId
- visibility

### 6.2 Example activity types

- LEAD_CREATED
- LEAD_ASSIGNED
- STATUS_CHANGED
- STAGE_CHANGED
- EMAIL_SENT
- EMAIL_RECEIVED
- WHATSAPP_SENT
- WHATSAPP_RECEIVED
- CALL_STARTED
- CALL_COMPLETED
- NOTE_CREATED
- TASK_CREATED
- TASK_COMPLETED
- MEETING_SCHEDULED
- PROPOSAL_GENERATED
- PROPOSAL_APPROVED
- PROPOSAL_SENT
- WORKFLOW_STARTED
- WORKFLOW_COMPLETED
- AGENT_EXECUTED
- HUMAN_TAKEOVER_STARTED
- HUMAN_TAKEOVER_RESOLVED
- DNC_APPLIED
- ORDER_CREATED

### 6.3 Separation from technical logs

User-facing timeline:
- meaningful business events
- human-readable
- safe for CRM users

Hidden internal logs:
- stack traces
- provider payloads
- queue internals
- retry diagnostics
- correlation traces
- model/tool debug information

---

## 7. Task Architecture

Introduce a first-class Task entity.

### 7.1 Task fields

- id
- workspaceId
- title
- description
- status
- priority
- dueAt
- reminderAt
- assignedToUserId
- createdByType
- createdByUserId
- createdByAgentId
- sourceType
- sourceId
- relatedLeadId
- relatedContactId
- relatedCompanyId
- relatedDealId
- relatedOrderId
- completedAt
- completedBy
- metadata
- createdAt
- updatedAt

### 7.2 Next Action migration

`Lead.nextAction/nextActionAt` should gradually become a projection of tasks / automation state rather than the only durable representation.

Do not remove existing fields immediately.

Use compatibility migration:
1. keep current fields
2. introduce Task
3. sync new tasks to nextAction projection
4. migrate UI
5. later deprecate legacy-only behavior

---

## 8. Deals and Pipelines

### 8.1 Pipeline model

Separate:
- Pipeline
- PipelineStage
- Deal

Pipeline stages must be workspace-scoped.

Recommended:
- Pipeline
  - id
  - workspaceId
  - name
  - type
  - isDefault
  - status
- PipelineStage
  - pipelineId
  - name
  - position
  - probability
  - isWon
  - isLost
  - color

### 8.2 Lead status vs deal stage vs AI intent

These are separate concepts.

Do not merge:
- Lead lifecycle status
- Deal/pipeline stage
- AI intent
- Priority
- Qualification score
- DNC state
- Automation state

---

## 9. Orders

Introduce Orders only after CRM foundations are stable.

### 9.1 Order model

- Order
- OrderItem
- PaymentStatus
- FulfillmentStatus

Order should connect to:
- workspace
- company
- contact
- deal
- owner
- activities

### 9.2 Keep scope controlled

The current reference confirms an Order Queue, but does not yet prove the need for:
- inventory
- shipping labels
- tax engine
- warehouse management
- refund processor
- payment gateway

Do not build those until requirements confirm them.

---

## 10. Agent Architecture

AI Agents are reusable automation capabilities.

### 10.1 Agent entity

Recommended:
- Agent
  - workspaceId
  - name
  - description
  - type
  - status
  - currentVersionId
  - createdBy
  - createdAt
  - updatedAt
- AgentVersion
  - agentId
  - version
  - definition JSON
  - model config
  - tools config
  - knowledge config
  - publishedAt
  - publishedBy
- AgentExecution
  - versionId
  - source
  - entity refs
  - status
  - startedAt
  - completedAt
  - result
  - correlationId

### 10.2 Candidate agent types

Existing functionality can map into agents such as:
- Outreach Agent
- Reply Understanding Agent
- Qualification Agent
- Proposal Agent
- Meeting Agent
- Voice Agent
- WhatsApp Agent
- Sales Copilot

These should reuse existing services rather than duplicate them.

### 10.3 Agent states

- DRAFT
- ACTIVE
- PAUSED
- ARCHIVED

Pause semantics must be safe:
- no new executions
- existing in-flight executions complete/cancel according to policy
- no silent data corruption

---

## 11. Agent Composer / Shortcuts

The visual Agent Composer defines the behavior inside a single agent.

### 11.1 Node categories

Potential nodes:
- Trigger
- Message
- Question
- Condition
- AI Decision
- Tool
- CRM Action
- Integration Action
- Wait
- Human Handoff
- End

### 11.2 Agent flow lifecycle

- Draft
- Validate
- Preview/Test
- Publish
- Versioned execution

Published versions are immutable.

Editing a published agent creates a new draft version.

---

## 12. Workflow Architecture

A Workflow coordinates business processes across CRM records and agents.

### 12.1 Workflow vs Agent

**Workflow**
- business/process orchestration
- record-level automation
- multi-step logic
- triggers and branching

**Agent**
- intelligent behavior
- reusable AI capability
- conversation/reasoning/action logic

A workflow may invoke an agent.

### 12.2 Workflow model

Recommended:
- Workflow
- WorkflowVersion
- WorkflowNode
- WorkflowEdge
- WorkflowExecution
- WorkflowStepExecution

### 12.3 Workflow lifecycle

- DRAFT
- PUBLISHED
- PAUSED
- ARCHIVED

Published versions immutable.

### 12.4 Node categories

- Trigger
- Condition
- Delay/Wait
- CRM Update
- Task Create
- Communication
- Agent Invoke
- Integration Action
- Webhook
- Human Approval
- End

### 12.5 Execution requirements

Every execution must support:
- durable status
- retries
- idempotency
- timestamps
- actor/source
- correlation ID
- failure reason
- retry state
- version reference
- resume/recovery behavior

---

## 13. Existing Automation Reuse

Existing automation should be exposed as capabilities/nodes.

Examples:

```text
Send Follow-up Email
→ existing followup/email services

Analyze Reply
→ existing reply-processing service

Qualify Lead
→ existing qualification/scoring

Generate Proposal
→ existing proposal-generation service

Approve/Send Proposal
→ existing proposal workflow

Schedule Meeting
→ existing meeting/calendar services

Make Voice Call
→ existing voice/calling sequence services

Send WhatsApp
→ existing messaging/worker services

Human Takeover
→ existing takeover controls

Apply DNC
→ existing suppression logic
```

Do not reimplement these inside workflow/agent modules.

---

## 14. AI Decision Policy

AI must not have unrestricted authority.

### 14.1 Central decision policy

Move AI decision authority into one reusable policy layer.

Policy inputs:
- intent
- confidence
- source channel
- lead state
- DNC state
- takeover state
- workflow policy
- agent policy
- workspace policy
- risk category

Policy outputs:
- allowed action
- requires human review
- blocked reason
- next state

### 14.2 Human review required for

At minimum:
- commercial commitments
- final pricing
- discounts
- contractual terms
- negotiation
- risky low-confidence actions
- configurable sensitive actions

### 14.3 Existing behavior to preserve

- proposal approval gate
- negotiation human takeover
- meeting confirmation flow
- DNC enforcement
- suppression
- human takeover blocking

---

## 15. Integrations Architecture

Integrations must be workspace-scoped and centrally managed.

### 15.1 Integration entity

Recommended:
- IntegrationConnection
- IntegrationCredentialRef
- IntegrationHealth
- IntegrationSyncState
- IntegrationEvent

Do not expose credentials to frontend.

### 15.2 Existing integrations

Reuse/consolidate:
- Zoho Bigin
- Google Calendar
- Gemini
- OpenAI
- Mail/SES
- Meta/Twilio WhatsApp
- Twilio/Exotel voice
- Redis/BullMQ infrastructure

### 15.3 Integration status

UI states:
- Connected
- Syncing
- Needs Attention
- Failed
- Disabled

Status must derive from real provider/configuration state.

### 15.4 Zoho/Bigin strategy

Because the client already uses Bigin:
- support Bigin import/sync as a migration/integration path
- preserve external connector capability
- do not make the new CRM dependent on Bigin internally
- the Shilabs CRM must own its own canonical CRM records

---

## 16. Audit Architecture

Every important change must answer:

- Who?
- What?
- When?
- Where?
- Why/source?
- Before?
- After?
- Correlation?

### 16.1 Actor types

- USER
- SYSTEM
- AGENT
- WORKFLOW
- INTEGRATION

### 16.2 Required audit coverage

- create/update/delete
- assignment
- status/stage change
- workflow publish
- agent publish
- integration connect/disconnect
- proposal approve/send
- human takeover
- DNC/suppression
- permission change
- user/member change
- order state change
- manual retry
- system/admin action

---

## 17. Security Prerequisites

Before broad CRM expansion, fix the known release blockers.

### 17.1 Required immediate fixes

- Secure Exotel status endpoints.
- Remove public static voice-token disclosure.
- Enforce object-level authorization.
- Introduce tenant/workspace scoping.
- Harden browser auth transport.
- Add retention/deletion strategy.
- Correct outbox dispatch race.
- Restrict retry endpoint to retryable states.

### 17.2 Additional hardening

Plan for:
- CSP
- HSTS
- secure cookie/session strategy
- MFA later
- password reset
- login lockout / abuse protections
- provider secret rotation
- webhook signature verification
- security event logging

---

## 18. Event and Queue Architecture

Keep the domain-event/outbox foundation but harden it.

### 18.1 Required fixes

Current race:
```text
BullMQ job added
before
DB event marked QUEUED
```

Must be corrected so a worker never sees a stale database state.

### 18.2 Retry policy

Retry only:
- FAILED
- ATTENTION_REQUIRED
- explicitly recoverable states

Do not allow arbitrary replay of successful or in-progress events.

### 18.3 Separate event categories

Prefer separation between:
- executable command events
- informational domain events
- analytics/audit events

Avoid one giant event enum with duplicated supported/no-op lists.

---

## 19. Realtime Architecture

Keep HTTP/persisted state as source of truth.

### 19.1 Preserve

- WebSocket as invalidation signal
- targeted refetch
- coalescing
- UI-context preservation

### 19.2 Improve

- no JWT in query string
- heartbeat
- backpressure
- multi-instance fan-out
- post-commit publication only
- typed scope mapping
- workspace-scoped event channels

---

## 20. Frontend Architecture

The existing frontend must be modularized before adding the full CRM.

### 20.1 Target frontend structure

```text
apps/web/src/
  app/
    router/
    providers/
    layout/
  features/
    leads/
    contacts/
    companies/
    deals/
    orders/
    tasks/
    agents/
    workflows/
    integrations/
    analytics/
    settings/
  components/
    data-table/
    drawer/
    modal/
    form/
    timeline/
    command-bar/
    badges/
    cards/
  services/
    api/
  design-system/
    tokens/
    primitives/
    patterns/
```

### 20.2 Avoid

- new 4,000-line components
- new giant global CSS files
- page-specific duplicated table components
- page-specific duplicated drawers
- independent status badge implementations

### 20.3 Routing

Move away from hand-written history routing toward a structured route system.

### 20.4 Data layer

Split monolithic API client into feature/service modules.

---

## 21. Design System

Pixel-perfectness requires a design system.

### 21.1 Define tokens

- spacing
- typography
- font sizes
- line heights
- radius
- borders
- shadow
- surface
- text hierarchy
- icon sizing
- status colors
- density
- transitions

### 21.2 Shared patterns

Build once:
- App Shell
- Sidebar
- Top Bar
- Profile Menu
- Page Header
- KPI Card
- Data Table
- Filter Bar
- Search Input
- Status Chip
- Priority Chip
- Drawer
- Modal
- Tabs
- Activity Timeline
- Empty State
- Loading Skeleton
- Error State
- Pagination
- Avatar stack
- Quick Action button
- Inspector panel
- Visual canvas shell

---

## 22. Navigation Architecture

The menu should visually follow the supplied reference style.

Proposed top-level product navigation:

- Overview
- Leads
- Contacts
- Companies
- Deals
- Orders
- Tasks
- Agents
- Workflows
- Activity
- Analytics
- Integrations
- Settings

Secondary modules may appear contextually.

User profile popup remains at sidebar bottom.

---

## 23. Reference Screen Mapping

### Screen 1 — Agents
Purpose:
- Agent management
- status
- performance
- tasks completed
- success rate
- time saved
- AI Copilot panel

### Screen 2 — Visual Pipeline / Workflow Builder
Purpose:
- visual automation canvas
- branching
- conditions
- actions
- publish lifecycle
- configuration inspector

### Screen 3 — Leads AI Overview
Purpose:
- AI briefing
- lead health
- KPI strip
- recommendations
- recommended actions

### Screen 4 — Agent Shortcuts / Composer
Purpose:
- configure internal agent behavior
- trigger/message/question/condition/action nodes
- preview/test/publish

### Screen 5 — Agent Workflow Execution / Evaluation
Purpose:
- internal agent composition
- executions
- evaluation
- hidden technical logs
- business-visible execution summaries

### Screen 6 — Global Sidebar
Purpose:
- common application shell
- clean icon/text navigation
- collapsed state

### Screen 7 — Profile Popup
Purpose:
- identity
- profile/settings
- member/admin options by permission
- logout

### Screen 8 — Integrations
Purpose:
- provider connections
- health/status
- enable/disable
- reconnect/fix
- disconnect

### Screen 9 — Leads List
Purpose:
- operational lead table
- bulk actions
- filtering
- owner/status/company/priority
- pagination

### Screen 10 — Lead Profile
Purpose:
- 360-degree lead workspace
- quick actions
- tabs
- activity
- proposals
- meetings
- qualification
- automation

### Screen 11 — Lead Sessions
Purpose:
- chronological business history
- notes
- conversations
- interactions
- reminders
- ratings/files
- actor/timestamp

### Screen 12 — Order Queue
Purpose:
- order operations
- payment state
- fulfillment state
- stats
- search/filter

### Screen 13 — Leads & CRM Command Center
Purpose:
- KPI metrics
- score
- intent
- value
- next action
- AI recommendation
- manager/sales intelligence

### Screen 14 — Lead Contacts Workspace
Purpose:
- rich lead cards
- saved filters
- lead segments
- engagement
- quick actions
- details drawer

### Screen 15 — Lead Quick View
Purpose:
- non-navigating right-side preview
- summary cards
- activity/tasks/meetings/deals
- full-details transition

### Screen 16 — Companies
Purpose:
- company/account cards
- owners
- quick actions
- search/filter/sort
- grid/list modes

---

## 24. Screen Consolidation Strategy

Do not build duplicate concepts.

### 24.1 Lead-related pages

Keep separate responsibilities:

**Leads List**
- dense operational table
- bulk management

**Lead Contacts Workspace**
- rich card-based browsing

**Lead Quick View**
- contextual side drawer

**Lead Profile**
- full workspace

**Lead Sessions**
- detailed activity history

**AI Lead Overview**
- briefing/recommendations

**CRM Command Center**
- manager/sales intelligence

All must read from the same canonical data model.

### 24.2 Workflow vs Agent Composer

Do not merge these into one generic canvas.

Workflow Builder:
- business process orchestration

Agent Composer:
- internal AI agent behavior

---

## 25. UI Familiarity With Bigin

The platform should feel familiar to Bigin users by preserving:
- record lists
- owners
- statuses
- pipeline stages
- activities
- tasks
- quick actions
- detail pages
- related tabs
- filters
- saved views
- search
- assignment
- meeting/call/email concepts

But visually and technically, Shilabs should follow the supplied modern references.

---

## 26. Migration Strategy

Do not rewrite the existing system.

### 26.1 Migration principles

- additive first
- compatibility layers
- backfill
- dual-read where needed
- migrate UI gradually
- remove legacy fields only after full migration

### 26.2 Suggested migration sequence

1. Baseline repository checkpoint.
2. Security fixes.
3. Workspace tenancy.
4. Central authorization policy.
5. Structured activity/audit contracts.
6. Task entity.
7. Frontend modularization/design system.
8. Pipeline model hardening.
9. Agent architecture.
10. Workflow architecture.
11. CRM pages.
12. Orders.
13. analytics/AI overview consolidation.
14. scale/realtime hardening.
15. production observability and release pipeline.

---

## 27. CI and Testing Strategy

No feature is complete without tests.

### 27.1 Required test layers

- unit
- service/integration
- DB-backed
- worker/queue
- API
- frontend component
- browser E2E
- provider contract mocks
- migration tests
- security authorization tests
- visual regression
- accessibility smoke

### 27.2 Test database isolation

Never run DB tests against shared development data.

Use isolated database/schema per test run.

### 27.3 Visual regression

Add Playwright.

For every reference screen:
- fixed viewport snapshots
- loading state
- empty state
- populated state
- selected/hover states
- drawer/modal states
- responsive widths

Reference images are acceptance targets.

---

## 28. Observability

Production platform must include:

- structured logs
- correlation IDs
- request IDs
- workflow execution IDs
- agent execution IDs
- metrics
- queue health
- provider latency/error rates
- AI cost/token usage where available
- tracing
- error monitoring
- readiness checks for DB and Redis
- graceful shutdown

---

## 29. Data Privacy and Retention

Required policy layer for:
- email content
- message content
- call transcripts
- provider payloads
- AI prompts/results
- files
- audit history
- deleted CRM records

Support:
- configurable retention
- export
- deletion
- redaction where required
- audit-safe deletion semantics

---

## 30. Reusability Rules for Codex

Codex must follow these rules:

1. Search for an existing service before creating a new one.
2. Extend existing proposal/meeting/communication systems.
3. Do not create parallel provider records.
4. Do not create a second event system.
5. Do not create a second realtime architecture.
6. Do not create per-page table/drawer/modal systems.
7. Do not duplicate permission logic across controllers.
8. Prefer shared domain services and policy helpers.
9. Keep UI state separate from server source of truth.
10. Add migrations incrementally.
11. Preserve existing tested automation behavior.
12. Add tests with every behavior change.

---

## 31. Robustness Rules for Codex

Every implementation must consider:
- idempotency
- retry safety
- partial failure
- authorization
- tenant isolation
- DNC
- human takeover
- concurrent updates
- provider timeout
- provider duplicate callbacks
- stale job recovery
- auditability
- realtime consistency
- version compatibility

---

## 32. Pixel-Perfect Implementation Rules

For each screen:
- attach the corresponding reference image
- match layout proportions
- match spacing rhythm
- match typography hierarchy
- match card density
- match border/radius/shadow behavior
- match drawer dimensions
- match sidebar behavior
- match table row density
- use shared tokens
- do not hardcode one-off CSS unless justified
- add visual regression coverage

---

## 33. Full E2E Platform Standard

A feature is not done when the page renders.

Example complete lead flow:

```text
Lead created
→ owner assigned
→ automation/workflow starts
→ outreach sent
→ customer replies
→ reply persisted
→ AI classifies
→ qualification updates
→ activity timeline records
→ next action/task updates
→ realtime invalidation occurs
→ salesperson sees update
→ proposal/meeting/handoff triggered
→ deal progresses
→ order may be created
→ analytics and AI overview update
→ full audit trail preserved
```

This is the minimum standard for “complete.”

---

## 34. Implementation Phase Strategy

Implementation should use vertical slices.

Each phase must include:
- schema/domain
- migration
- service/API
- authorization
- audit/activity
- realtime
- UI
- tests
- visual acceptance
- E2E verification

Do not build “all frontend first” or “all backend first.”

---

## 35. Proposed Phase Order

### Phase 0 — Baseline and safety
- clean checkpoint/commit
- document current branch/state
- secure Exotel
- fix retry safety
- fix outbox dispatch race
- basic CI
- isolated DB tests

### Phase 1 — Workspace + RBAC foundation
- Workspace
- Membership
- tenant-scoped repositories
- authorization policies
- migration of existing records
- workspace-aware realtime/events

### Phase 2 — Activity + Audit + Tasks
- structured timeline
- task entity
- actor/source model
- next-action compatibility
- activity UI primitive

### Phase 3 — Frontend platform shell
- route architecture
- design system
- sidebar
- profile popup
- API client modularization
- common table/drawer/modal/timeline

### Phase 4 — Core CRM records
- Leads
- Contacts
- Companies
- Lead quick view
- Lead profile
- Lead sessions
- list/card views
- saved filters

### Phase 5 — Deals + Pipelines
- workspace pipelines
- stage management
- deal lifecycle
- pipeline UI
- existing proposal/meeting reuse

### Phase 6 — Agents
- agent entity/versioning
- agent management page
- agent pause/resume
- existing AI capability mapping
- execution records

### Phase 7 — Agent Composer
- visual canvas
- nodes
- validation
- test/preview
- publish/versioning

### Phase 8 — Workflows
- workflow model/versioning
- node engine
- durable execution
- visual builder
- invoke agents
- reuse existing automation actions

### Phase 9 — Integrations
- workspace-scoped integration management
- health model
- UI
- consolidate provider config
- Bigin sync path

### Phase 10 — AI lead intelligence
- lead briefing
- command center
- recommendations
- health score
- actionable AI insights

### Phase 11 — Orders
- order model
- queue UI
- payment/fulfillment states
- deal linkage

### Phase 12 — Analytics / scale / production hardening
- multi-instance realtime
- observability
- retention
- load testing
- deployment pipeline
- production readiness review

---

## 36. Definition of Done for Every Phase

A phase is complete only when:

- schema/migrations are correct
- data backfill is safe
- authorization enforced
- audit records created
- realtime behavior correct
- UI matches reference
- error/loading/empty states exist
- tests pass
- visual regression passes
- E2E path passes
- no existing automation regression
- documentation updated
- migration/release notes written

---

## 37. Codex Working Contract

For each future Codex task:

1. Provide this master specification.
2. Provide the relevant screen image(s).
3. Provide a phase-specific implementation brief.
4. Require repository inspection before coding.
5. Require reuse mapping.
6. Require migration plan.
7. Require exact file-change summary.
8. Require tests.
9. Require UI visual acceptance.
10. Require E2E verification.
11. Do not allow unrelated refactors.
12. Do not allow silent behavior changes.

---

## 38. Immediate Next Step

Do **not** begin all CRM screens.

The next implementation task should be **Phase 0 — Baseline and Safety**, because the current assessment found:
- a dirty/untracked production workspace
- Exotel endpoint security risk
- inconsistent authorization
- outbox dispatch ordering race
- unsafe retry behavior
- no CI gate
- no isolated DB test environment

After Phase 0 passes, proceed to Workspace/RBAC.

---

## 39. Architectural Decisions That Must Remain Stable

Until explicitly changed:

- PostgreSQL + Prisma remain the primary persistence layer.
- BullMQ/Redis remains the job backbone.
- Existing domain outbox remains the durable event foundation.
- Existing proposal workflow is reused.
- Existing meeting workflow is reused.
- Existing communication/provider records are reused.
- Existing AI provider abstraction is reused.
- HTTP persisted state remains frontend source of truth.
- Realtime remains invalidation-oriented.
- CRM becomes workspace-scoped.
- Workflow and Agent are separate concepts.
- User-facing Activity is separate from hidden technical logs.
- Bigin remains an integration/migration path, not the internal source of truth.
- Reference screenshots remain UI targets.

---

## 40. Final Product Vision

Shilabs should become:

> A complete AI-native CRM where sales teams can manage companies, contacts, leads, deals, tasks, meetings, proposals, orders, communications, agents, workflows, and integrations from one unified platform, while existing AI sales automation runs safely underneath with human control, full auditability, robust event processing, and familiar CRM interactions.

The target product must combine:

**Bigin familiarity**
+
**modern reference-image UI**
+
**existing Shilabs automation**
+
**production-grade CRM architecture**
+
**reusable AI agents/workflows**
+
**full end-to-end correctness**
