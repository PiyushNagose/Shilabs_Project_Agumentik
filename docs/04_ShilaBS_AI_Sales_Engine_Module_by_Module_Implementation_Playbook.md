# SHILABS AI SALES ENGINE
# Module-by-Module Implementation Playbook for Codex

Version: 1.0  
Purpose: Complete implementation guide for building, testing, integrating, and deploying the Shilabs AI Sales Engine step by step.

---

# 0. HOW CODEX MUST USE THIS FILE

This file is the implementation playbook.

Codex must:

1. Read this file completely before starting work.
2. Read the product documentation and architecture/folder-structure documents.
3. Work on exactly one milestone or module group at a time.
4. Do not jump ahead.
5. Do not introduce unapproved third-party SaaS dependencies.
6. Do not rewrite unrelated modules while working on a scoped task.
7. Run tests, lint, and type-check after every milestone.
8. Stop after each milestone and report:
   - files created
   - files modified
   - commands run
   - tests passed/failed
   - assumptions
   - unresolved risks
9. Wait for review before continuing.

The source-of-truth rule is:

**Product docs define what.  
Architecture docs define how the system is shaped.  
This playbook defines the exact implementation order.**

---

# 1. NON-NEGOTIABLE ARCHITECTURE RULES

## 1.1 In-house core

The following must remain in-house:

- authentication
- users and RBAC
- companies
- contacts
- leads
- deals
- pipeline
- conversations
- messages
- qualification
- lead scoring
- automation engine
- follow-up engine
- internal meeting logic
- knowledge base
- analytics
- dashboard
- notifications
- audit history
- AI orchestration rules
- system configuration

Do not use these as core replacements:

- HubSpot
- n8n
- Make
- Zapier
- Calendly as scheduling core
- Airtable
- Looker Studio

External providers are allowed only behind adapters where necessary:

- OpenAI or another LLM provider
- Meta WhatsApp Business Platform
- email/SMTP provider
- optional Google/Microsoft calendar sync
- S3-compatible object storage if required

---

## 1.2 Application owns business state

AI must never be the source of truth for:

- permissions
- lead score
- pipeline stage
- opt-out
- workflow state
- retry state
- ownership
- audit log
- meeting status
- delivery state

AI may:

- classify
- extract
- summarize
- generate drafts
- generate approved messages
- recommend next actions
- research later

---

## 1.3 Initial technical approach

Use:

- React + TypeScript
- Node.js + TypeScript
- Express or Fastify
- PostgreSQL
- Prisma
- Redis
- BullMQ
- Socket.IO or WebSocket
- OpenAI behind internal provider interface
- PostgreSQL + pgvector for RAG later
- Docker
- Vitest/Jest
- Supertest
- Playwright

Start as:

- modular monolith API
- separate worker
- shared packages

Do not start with microservices.

---

# 2. REPOSITORY SETUP

Expected structure:

```text
shilabs-ai-sales-engine/
|
+-- apps/
|   +-- web/
|   +-- api/
|   +-- worker/
|
+-- packages/
|   +-- shared-types/
|   +-- validation/
|   +-- shared-config/
|   +-- ui/
|
+-- docs/
|   +-- product/
|   +-- architecture/
|   +-- api/
|   +-- flows/
|   +-- decisions/
|
+-- scripts/
+-- docker/
+-- .env.example
+-- docker-compose.yml
+-- README.md
```

---

# 3. MASTER DELIVERY ORDER

Implement in this exact order:

```text
M0  Repository Scaffolding
M1  Database Foundation
M2  Authentication + RBAC + Users
M3  Companies + Contacts
M4  Leads
M5  Pipeline + Deals + Activities + Audit
M6  Frontend CRM Foundation
M7  Conversations + Messages
M8  Internal Conversation Simulator
M9  AI Provider Layer
M10 Qualification
M11 Lead Scoring
M12 Knowledge Base
M13 AI SDR Response Engine
M14 Event System
M15 Redis + BullMQ Worker
M16 Follow-up Automation Engine
M17 WhatsApp Integration
M18 Human Takeover
M19 Meeting + Availability Engine
M20 Optional Calendar Sync
M21 Notifications
M22 Dashboard
M23 Analytics
M24 AI Lead Summary + Recommendations
M25 Integration Health
M26 Security Hardening
M27 End-to-End Testing
M28 Deployment
M29 UAT + Stabilization
M30 Phase-2 Hooks
```

Do not proceed to an external integration until the internal equivalent works first.

---

# 4. M0 — REPOSITORY SCAFFOLDING

## Goal

Create the monorepo foundation only.

## Create

- root workspace package.json
- apps/web
- apps/api
- apps/worker
- packages/shared-types
- packages/validation
- packages/shared-config
- packages/ui
- docs folders
- docker-compose.yml
- .env.example
- README.md
- TypeScript configs
- ESLint
- Prettier
- test runner setup
- base health endpoints

## Do not create yet

- lead business logic
- AI logic
- WhatsApp logic
- queue jobs
- real CRM services

## Required endpoints

```text
GET /health
GET /ready
```

## Tests

- API boots
- health returns 200
- frontend boots
- worker boots
- workspace type-check passes

## Definition of Done

- `npm install` works from root
- web/API/worker can run independently
- PostgreSQL and Redis can run through Docker
- lint passes
- type-check passes
- base tests pass

## Codex checkpoint

STOP.

Report:

- complete tree
- installed dependencies
- commands
- test results

---

# 5. M1 — DATABASE FOUNDATION

## Goal

Establish PostgreSQL and Prisma cleanly.

## Create Prisma models initially

- User
- Role or role enum
- Company
- Contact
- Lead
- PipelineStage
- Deal
- Activity
- AuditEvent

Do not create every future field blindly. Add a solid core schema first.

## Required enums

Suggested:

```text
UserRole
LeadStatus
LeadTemperature
DealStatus
ActivityType
AuditActorType
```

## Required features

- timestamps
- foreign keys
- indexes
- soft-delete only where justified
- database migration strategy
- seed script

## Seed data

Create:

- default admin user
- standard pipeline stages
- basic system settings

Recommended stages:

```text
NEW
CONTACTED
ENGAGED
QUALIFIED
MEETING_BOOKED
PROPOSAL
NEGOTIATION
WON
LOST
NURTURE
```

## Tests

- migration applies to empty DB
- seed completes
- Prisma client generated
- foreign keys behave correctly
- important indexes exist

## Definition of Done

Fresh environment can run:

```bash
docker compose up
npm run db:migrate
npm run db:seed
```

without manual database edits.

STOP.

---

# 6. M2 — AUTHENTICATION, RBAC, USERS

## Goal

Implement secure access before business features.

## Roles

At minimum:

```text
ADMIN
SALES_MANAGER
SALES_REP
```

## Required API

```text
POST /api/auth/login
POST /api/auth/logout
POST /api/auth/refresh   # if refresh-token approach is used
GET  /api/auth/me

GET    /api/users
GET    /api/users/:id
POST   /api/users
PATCH  /api/users/:id
PATCH  /api/users/:id/status
```

## Service responsibilities

Auth service:

- password validation
- token/session creation
- token/session invalidation
- current user lookup

User service:

- create user
- update profile
- assign role
- deactivate account

## Security rules

- password hashing
- no raw password logs
- rate-limit login
- validation
- role middleware
- disabled users cannot authenticate

## Frontend

Create:

- login page
- protected routes
- authenticated app shell
- user menu
- logout
- role-aware navigation

## Tests

Unit:

- password hashing
- token/session generation
- role checks

API:

- successful login
- invalid password
- disabled user
- unauthorized route
- forbidden role

Frontend:

- redirect to login
- authenticated user sees app shell
- logout clears session

## Definition of Done

Admin, manager, and rep can authenticate and receive correct access.

STOP.

---

# 7. M3 — COMPANIES + CONTACTS

## Goal

Create CRM identity foundation.

## Company model

Fields:

- id
- name
- website
- industry
- location
- employeeRange
- notes
- createdAt
- updatedAt

## Contact model

Fields:

- id
- companyId
- firstName
- lastName
- role/title
- email
- phone
- whatsappId
- source
- preferredChannel
- doNotContact
- createdAt
- updatedAt

## Required API

```text
GET    /api/companies
POST   /api/companies
GET    /api/companies/:id
PATCH  /api/companies/:id

GET    /api/contacts
POST   /api/contacts
GET    /api/contacts/:id
PATCH  /api/contacts/:id
```

## Duplicate rules

At minimum:

- normalized email
- normalized phone
- WhatsApp provider identity
- optional company website/domain

Do not silently create duplicate contacts.

## Tests

- create company
- create contact
- link contact to company
- duplicate email handling
- duplicate phone handling
- do-not-contact persisted

## Definition of Done

Companies and contacts can be created and safely reused by future lead intake.

STOP.

---

# 8. M4 — LEADS

## Goal

Create the central lead entity.

## Lead fields

Recommended:

```text
id
companyId
contactId
ownerId
source
status
stageId
requirement
serviceInterest
score
temperature
estimatedValue
currency
nextAction
nextActionAt
lastActivityAt
createdAt
updatedAt
```

## Required API

```text
POST   /api/leads
GET    /api/leads
GET    /api/leads/:id
PATCH  /api/leads/:id
PATCH  /api/leads/:id/assign
PATCH  /api/leads/:id/status
```

## List query support

- pagination
- search
- source filter
- status filter
- stage filter
- owner filter
- score range
- temperature
- sort by latest activity
- sort by created date

## Lead service responsibilities

- create lead
- match existing company/contact
- assign owner
- update status
- update next action
- emit lead events
- create audit events

## No AI here

Do not call AI during Lead CRUD.

## Tests

- create
- edit
- assign
- validation
- unauthorized assignment
- filters
- pagination
- audit entries

## Definition of Done

Lead lifecycle works manually without AI.

STOP.

---

# 9. M5 — PIPELINE + DEALS + ACTIVITIES + AUDIT

## Goal

Create internal CRM mechanics.

## Deal fields

```text
id
leadId
stageId
ownerId
value
currency
probability
status
proposalStatus
wonReason
lostReason
createdAt
updatedAt
```

## PipelineStage

Fields:

- id
- key
- label
- order
- probability
- isClosed
- isWon
- isLost

## Required API

```text
GET   /api/pipeline/stages
PATCH /api/leads/:id/stage

POST  /api/deals
GET   /api/deals/:id
PATCH /api/deals/:id

GET   /api/leads/:id/activities
```

## Stage transition logic

Implement server-side validation.

Examples:

- CLOSED/WON should not automatically return to NEW without authorized override
- stage change creates activity
- stage change creates audit event
- deal probability may default from stage

## Activity examples

```text
LEAD_CREATED
OWNER_CHANGED
STAGE_CHANGED
NOTE_ADDED
MESSAGE_SENT
MESSAGE_RECEIVED
SCORE_CHANGED
MEETING_BOOKED
FOLLOWUP_SCHEDULED
HUMAN_TAKEOVER
```

## Audit

AuditEvent should store:

- actor type
- actor id
- entity type
- entity id
- action
- before metadata
- after metadata
- timestamp

## Tests

- valid transition
- invalid transition
- activity created
- audit created
- deal value update
- probability default

## Definition of Done

CRM works manually end to end.

STOP.

---

# 10. M6 — FRONTEND CRM FOUNDATION

## Goal

Build actual sales workspace before AI.

## Pages

### Leads List

Columns:

- company/contact
- source
- score
- temperature
- stage
- owner
- last activity
- next action

Features:

- search
- filters
- pagination
- sort
- click lead

### Lead Detail

Header:

- company
- contact
- stage
- owner
- score
- temperature
- source
- deal value
- next action

Tabs:

- Overview
- Conversation
- Qualification
- Activities
- Meetings
- Deal
- AI Insights

### Pipeline

Kanban or grouped list.

Cards:

- company
- value
- score
- owner
- last activity
- next action

## Tests

- lead list loads
- filters work
- Lead Detail loads
- stage change persists
- owner assignment persists

## Definition of Done

Salesperson can manage CRM without AI.

STOP.

---

# 11. M7 — CONVERSATIONS + MESSAGES

## Goal

Create internal communication model.

## Conversation fields

```text
id
leadId
channel
mode
status
lastMessageAt
createdAt
updatedAt
```

Modes:

```text
AUTO
DRAFT_ONLY
HUMAN
PAUSED
CLOSED
```

## Message fields

```text
id
conversationId
providerMessageId
direction
senderType
body
deliveryStatus
sentAt
deliveredAt
readAt
failedAt
metadata
createdAt
```

## Required API

```text
GET  /api/conversations
GET  /api/conversations/:id
GET  /api/conversations/:id/messages
POST /api/conversations/:id/messages
PATCH /api/conversations/:id/mode
```

## Delivery status

```text
PENDING
SENT
DELIVERED
READ
FAILED
```

## Tests

- create conversation
- append message
- order messages
- update conversation lastMessageAt
- change mode
- audit mode change

## Definition of Done

Internal conversation data model works without WhatsApp.

STOP.

---

# 12. M8 — INTERNAL CONVERSATION SIMULATOR

## Goal

Test AI and CRM workflows before external messaging.

## UI

Create internal simulator:

```text
Prospect simulator
[message input]

Conversation thread

AI Mode selector

Lead qualification panel

Lead score panel

Activity log
```

## Behavior

A developer/test user can simulate:

Prospect:

> We need a new real-estate website.

System stores this as inbound.

Later AI will answer through same conversation pipeline.

## Tests

- simulated inbound message saved
- activity created
- conversation visible in UI
- realtime update works if enabled

## Definition of Done

Entire messaging flow can be tested locally without Meta.

STOP.

---

# 13. M9 — AI PROVIDER LAYER

## Goal

Create vendor-independent AI abstraction.

## Do not call OpenAI from feature modules.

Create:

```ts
interface AIProvider {
  generateSalesReply(input: SalesReplyInput): Promise<SalesReplyResult>;
  extractQualification(input: QualificationInput): Promise<QualificationResult>;
  summarizeLead(input: LeadSummaryInput): Promise<LeadSummaryResult>;
  generateFollowUp(input: FollowUpInput): Promise<FollowUpResult>;
  createEmbedding(text: string): Promise<number[]>;
}
```

Implement:

```text
OpenAIProvider
MockAIProvider
```

Mock provider is required for deterministic tests.

## Configuration

Environment:

```text
AI_PROVIDER=openai
OPENAI_API_KEY=
OPENAI_MODEL=
```

## Reliability

- timeout
- retries only where safe
- structured output validation
- provider errors mapped to internal errors
- no secrets in logs

## Tests

- mock provider success
- invalid output rejected
- timeout handled
- provider error handled

## Definition of Done

AI can be swapped without changing business modules.

STOP.

---

# 14. M10 — QUALIFICATION

## Goal

Extract structured sales information from conversation.

## Qualification fields

```text
need
requirement
budget
budgetBand
authority
timeline
businessFit
decisionMakerIdentified
urgency
evidence
updatedAt
```

## Rules

- unknown values remain null
- AI must include evidence references where possible
- do not infer certainty without evidence
- server validates result

## API

```text
GET   /api/leads/:id/qualification
PATCH /api/leads/:id/qualification   # human correction
POST  /api/leads/:id/qualification/recalculate
```

## Processing flow

```text
new message
↓
load recent conversation
↓
AI extraction
↓
schema validation
↓
merge only valid fields
↓
save evidence
↓
emit QUALIFICATION_UPDATED
```

## Tests

- valid extraction
- missing fields
- malformed AI result
- human override
- evidence saved
- no hallucinated required fields

## Definition of Done

Conversation updates structured qualification reliably.

STOP.

---

# 15. M11 — LEAD SCORING

## Goal

Create deterministic scoring independent of AI.

## Scoring engine

Initial model:

```text
clear requirement +20
decision authority +20
budget identified +20
timeline identified +20
strong business fit +20
```

## Output

```text
80-100 HOT
60-79 WARM
0-59 NURTURE
```

## Create

- scoring service
- configurable weights
- configurable thresholds
- score explanation

## API

```text
GET   /api/scoring/config
PATCH /api/scoring/config
POST  /api/leads/:id/recalculate-score
```

Admin only for config.

## Event

```text
LEAD_SCORE_CHANGED
```

## Tests

- each factor
- exact boundaries 59/60/79/80
- recalculation
- config change
- audit
- AI cannot directly set score

## Definition of Done

Lead score is predictable and explainable.

STOP.

---

# 16. M12 — KNOWLEDGE BASE

## Goal

Give AI controlled company knowledge.

## KnowledgeItem fields

```text
id
category
title
content
status
version
sourceReference
effectiveFrom
effectiveTo
createdBy
approvedBy
createdAt
updatedAt
```

Statuses:

```text
DRAFT
REVIEW
APPROVED
ARCHIVED
```

Categories:

- COMPANY
- SERVICE
- PRICING_RULE
- CASE_STUDY
- FAQ
- OBJECTION
- SALES_SCRIPT
- GUARDRAIL

## API

```text
GET    /api/knowledge
POST   /api/knowledge
GET    /api/knowledge/:id
PATCH  /api/knowledge/:id
POST   /api/knowledge/:id/submit-review
POST   /api/knowledge/:id/approve
POST   /api/knowledge/:id/archive
```

## Rule

Only APPROVED knowledge is available to production AI.

## RAG v1

Start with simple category/service filtering.

Add pgvector only after basic retrieval works.

## Tests

- draft not retrievable
- approved item retrievable
- archive removes from production retrieval
- versioning works
- unauthorized approval blocked

## Definition of Done

AI can only receive approved knowledge.

STOP.

---

# 17. M13 — AI SDR RESPONSE ENGINE

## Goal

Generate sales replies safely.

## Prompt layers

1. system role
2. sales rules
3. company guardrails
4. lead context
5. qualification state
6. approved knowledge
7. recent conversation
8. current task

## Core rules

- ask one useful question at a time
- do not aggressively sell
- never invent pricing
- never invent case studies
- never guarantee results
- escalate sensitive/high-value cases
- keep replies concise and consultative

## Flow

```text
inbound message
↓
check conversation mode
↓
load lead
↓
load qualification
↓
retrieve approved knowledge
↓
build bounded prompt
↓
AIProvider.generateSalesReply
↓
validate response
↓
save outbound pending message
↓
send internally in simulator
```

External sending comes later.

## Tests

Use MockAIProvider.

Test:

- AUTO responds
- HUMAN does not respond
- PAUSED does not respond
- CLOSED does not respond
- missing knowledge
- safe refusal/escalation
- prompt excludes unapproved knowledge

## Definition of Done

Internal simulator can hold multi-turn AI qualification conversation.

STOP.

---

# 18. M14 — EVENT SYSTEM

## Goal

Decouple domain actions.

## Core events

```text
LEAD_CREATED
LEAD_UPDATED
MESSAGE_RECEIVED
MESSAGE_SENT
QUALIFICATION_UPDATED
LEAD_SCORE_CHANGED
STAGE_CHANGED
FOLLOWUP_SCHEDULED
FOLLOWUP_CANCELLED
MEETING_BOOKED
MEETING_RESCHEDULED
HUMAN_TAKEOVER
AI_MODE_CHANGED
LEAD_OPTED_OUT
```

## Rule

Events represent facts that already occurred.

Do not use event names like:

```text
SHOULD_SEND_MESSAGE
```

Use commands/jobs separately.

## Tests

- event emitted once
- event payload validated
- listener failure does not corrupt successful DB transaction
- audit listener works

## Definition of Done

Important business changes emit typed events.

STOP.

---

# 19. M15 — REDIS + BULLMQ WORKER

## Goal

Create durable delayed and retryable processing.

## Queues

Suggested:

```text
ai
followup
messaging
notifications
meeting-sync
analytics
```

## Worker requirements

- retries
- exponential backoff where appropriate
- dead/failure handling
- idempotent processing
- structured logs
- job correlation id
- graceful shutdown

## Tests

- enqueue
- worker processes
- retry
- failed job state
- duplicate job protection
- worker restart does not lose job

## Definition of Done

System can execute durable delayed jobs.

STOP.

---

# 20. M16 — FOLLOW-UP AUTOMATION ENGINE

## Goal

Replace n8n-like behavior internally for sales follow-up.

## AutomationRule

Fields:

```text
id
name
trigger
conditions
delay
actions
stopConditions
retryPolicy
version
enabled
```

## FollowUp entity

```text
id
leadId
conversationId
ruleId
scheduledAt
channel
sequenceStep
status
jobId
retryCount
createdAt
updatedAt
```

Statuses:

```text
PENDING
PROCESSING
SENT
CANCELLED
SKIPPED
FAILED
```

## Example

Trigger:

```text
MESSAGE_SENT
```

Delay:

```text
48 hours
```

Conditions:

- no inbound reply
- AUTO mode
- not opted out
- lead not WON/LOST
- no human takeover

Action:

- generate follow-up
- send
- create activity
- schedule next step

## Critical worker rule

Before sending:

RE-CHECK ELIGIBILITY.

Never trust conditions evaluated 48 hours earlier.

## On inbound reply

Cancel pending follow-up jobs for that conversation.

## API

```text
GET   /api/followups
GET   /api/leads/:id/followups
POST  /api/followups/:id/cancel
POST  /api/followups/:id/reschedule
GET   /api/automation/rules
POST  /api/automation/rules
PATCH /api/automation/rules/:id
```

## Tests

- follow-up schedules
- reply cancels
- HUMAN mode skips
- opt-out skips
- WON lead skips
- failed send retries
- exhausted retry becomes FAILED
- duplicate send prevented

## Definition of Done

Internal follow-up works without WhatsApp.

STOP.

---

# 21. M17 — WHATSAPP INTEGRATION

## Goal

Connect internal messaging model to Meta.

## Adapter

Create:

```ts
interface MessagingProvider {
  sendMessage(input: SendMessageInput): Promise<SendMessageResult>;
}
```

Implement:

```text
WhatsAppMessagingProvider
MockMessagingProvider
```

## Webhook flow

```text
Meta webhook
↓
verify
↓
dedupe provider message ID
↓
find/create contact
↓
find/create lead
↓
find/create conversation
↓
save inbound
↓
emit MESSAGE_RECEIVED
↓
AI engine may respond
↓
save outbound pending
↓
send provider
↓
update delivery status
```

## Endpoints

```text
GET  /api/webhooks/whatsapp   # verification
POST /api/webhooks/whatsapp   # events
```

## Idempotency

Required:

- providerMessageId unique
- repeated webhook does not duplicate message
- outbound idempotency key

## Tests

- webhook verification
- valid inbound
- duplicate inbound
- contact matching
- delivery update
- send failure
- retry
- opt-out handling

## Definition of Done

Real WhatsApp message appears in Shilabs and can receive controlled AI reply.

STOP.

---

# 22. M18 — HUMAN TAKEOVER

## Goal

Guarantee human control.

## Triggers

- manual takeover
- enterprise/high-value threshold
- sensitive question
- custom pricing
- low AI confidence
- explicit prospect request
- manager policy

## API

```text
POST /api/conversations/:id/takeover
POST /api/conversations/:id/return-to-ai
PATCH /api/conversations/:id/mode
```

## Critical behavior

When HUMAN activated:

- cancel queued AI replies
- cancel incompatible pending follow-ups
- do not auto-send
- continue saving inbound messages
- notify assigned salesperson

## Race-condition protection

Worker must re-check mode immediately before sending.

## Tests

- manual takeover
- queued job skips after takeover
- reply still stored
- return to AUTO
- audit created
- unauthorized user blocked

## Definition of Done

AI can never speak after takeover unless explicitly returned to AI mode.

STOP.

---

# 23. M19 — INTERNAL MEETING + AVAILABILITY ENGINE

## Goal

Replace Calendly-style core logic.

## User availability

Fields:

```text
userId
dayOfWeek
startTime
endTime
timezone
```

Support:

- working hours
- meeting duration
- buffer
- blocked dates
- existing internal bookings

## Meeting

Fields:

```text
id
leadId
ownerId
startAt
endAt
timezone
status
notes
outcome
externalCalendarId
createdAt
updatedAt
```

Statuses:

```text
SCHEDULED
CONFIRMED
COMPLETED
CANCELLED
NO_SHOW
```

## API

```text
GET  /api/availability
POST /api/meetings
GET  /api/meetings
GET  /api/meetings/:id
PATCH /api/meetings/:id
POST /api/meetings/:id/reschedule
POST /api/meetings/:id/cancel
```

## Double booking

Use transaction/constraint.

Do not trust frontend availability alone.

## Tests

- valid slots
- timezone
- blocked slots
- double booking
- reschedule
- cancellation

## Definition of Done

Meeting booking works completely without external calendar.

STOP.

---

# 24. M20 — OPTIONAL CALENDAR SYNC

## Goal

Sync, not own, scheduling.

## Adapter

```ts
interface CalendarProvider {
  createEvent(...)
  updateEvent(...)
  cancelEvent(...)
  listBusyTimes(...)
}
```

Implement provider later.

## Rule

Internal Meeting is authoritative.

Calendar sync failure must not delete internal meeting.

## Tests

- create sync
- update sync
- cancellation sync
- provider failure
- retry

## Definition of Done

External calendar is a secondary integration.

STOP.

---

# 25. M21 — NOTIFICATIONS

## Goal

Notify users of important events.

## Notification examples

- new hot lead
- human takeover assigned
- meeting booked
- follow-up failed
- WhatsApp disconnected
- high-value lead qualified
- deal at risk

## API

```text
GET   /api/notifications
PATCH /api/notifications/:id/read
PATCH /api/notifications/read-all
```

## Tests

- correct recipient
- no duplicate important alerts
- read state
- permission

## Definition of Done

Operational users receive in-app alerts.

STOP.

---

# 26. M22 — DASHBOARD

## Goal

Build dashboard from real DB data.

## KPI row

- pipeline value
- weighted pipeline
- new leads
- qualified leads
- meetings
- proposals
- won revenue

## Sections

- Hot Opportunities
- At Risk
- Follow-ups Due
- Recent AI Activity
- Funnel
- Source Performance

## Do not use AI for basic metrics.

Example at-risk v1:

```text
stage = PROPOSAL
AND lastActivityAt < now - 7 days
```

## API

```text
GET /api/dashboard/summary
GET /api/dashboard/hot-opportunities
GET /api/dashboard/at-risk
GET /api/dashboard/followups-due
GET /api/dashboard/recent-activity
```

## Tests

- exact KPI counts
- correct date ranges
- manager vs rep visibility
- empty dataset

## Definition of Done

Dashboard is operational and explainable.

STOP.

---

# 27. M23 — ANALYTICS

## Goal

Measure funnel and sales effectiveness.

## Metrics

- lead-to-engaged
- engaged-to-qualified
- qualified-to-meeting
- meeting-to-proposal
- proposal-to-win
- average sales cycle
- source performance
- owner performance
- pipeline aging
- win/loss reasons

## API

```text
GET /api/analytics/funnel
GET /api/analytics/sources
GET /api/analytics/pipeline-aging
GET /api/analytics/conversion
GET /api/analytics/win-loss
```

## Tests

Use fixed seed datasets and assert exact results.

## Definition of Done

Metrics can be trusted by management.

STOP.

---

# 28. M24 — AI LEAD SUMMARY + RECOMMENDATIONS

## Goal

Add AI management intelligence after reliable data exists.

## Generate

- lead summary
- buying signals
- objections
- risks
- suggested next action

## Important

Recommendations are advisory.

They must not:

- move stage automatically
- modify score automatically
- send messages automatically unless a separate rule authorizes it

## Tests

- output schema
- summary includes relevant evidence
- no invented deal facts
- stale summary clearly timestamped

## Definition of Done

Salesperson sees useful AI summary grounded in system data.

STOP.

---

# 29. M25 — INTEGRATION HEALTH

## Goal

Expose external service health.

## Track

- AI provider
- WhatsApp
- email
- calendar
- Redis/worker

## Status

```text
CONNECTED
DEGRADED
DISCONNECTED
ACTION_REQUIRED
```

## Dashboard/admin UI

Show:

- current status
- last success
- last failure
- error summary
- retry/test action where safe

## Definition of Done

Failures are visible, not silent.

STOP.

---

# 30. M26 — SECURITY HARDENING

## Must complete before release

- input validation
- RBAC audit
- secret handling
- webhook signature validation
- rate limiting
- CORS
- secure headers
- token/session expiry
- password policy
- SQL injection protection through ORM
- log sanitization
- PII-aware logging
- backup procedure
- restore procedure
- error handling
- provider timeouts
- idempotency
- audit coverage
- dependency vulnerability scan

## Security tests

- broken access control
- role escalation
- unauthorized lead access
- replayed webhook
- duplicate message
- invalid signature
- brute-force login protection
- sensitive error leakage

## Definition of Done

No known critical/high-severity issue remains.

STOP.

---

# 31. M27 — END-TO-END TESTING

## Full user journeys

### Journey 1 — Manual CRM

```text
Login
→ create company
→ create contact
→ create lead
→ assign rep
→ move stage
→ create deal
```

### Journey 2 — AI qualification

```text
simulated inbound message
→ AI reply
→ multiple conversation turns
→ qualification update
→ score update
→ lead becomes hot
```

### Journey 3 — Follow-up

```text
outbound sent
→ no reply
→ follow-up scheduled
→ worker executes
```

### Journey 4 — Follow-up cancellation

```text
outbound sent
→ follow-up queued
→ inbound reply arrives
→ follow-up cancelled
```

### Journey 5 — Human takeover

```text
AI active
→ salesperson takes over
→ queued AI send tries to run
→ worker skips
→ salesperson replies manually
```

### Journey 6 — WhatsApp

```text
real/mock webhook
→ contact match
→ lead match
→ message stored
→ AI reply
→ delivery update
```

### Journey 7 — Meeting

```text
qualified lead
→ availability requested
→ slot booked
→ duplicate request blocked
→ reschedule
→ cancel
```

### Journey 8 — Dashboard

```text
seed known dataset
→ KPI values checked
→ filters checked
→ permission visibility checked
```

## Non-functional

- error recovery
- worker restart
- Redis reconnect
- DB reconnect
- AI timeout
- messaging outage
- duplicate webhook burst

## Definition of Done

All critical user journeys pass repeatedly.

STOP.

---

# 32. M28 — DEPLOYMENT

## Recommended deployment shape

```text
web
api
worker
postgres
redis
object storage optional
```

Use Docker.

## Required environments

- local
- staging
- production

## Required deployment items

- environment validation
- database migrations
- migration rollback plan
- HTTPS
- domain config
- logs
- uptime monitoring
- backup
- secrets
- health checks
- worker health
- queue visibility
- staging smoke test

## CI pipeline

At minimum:

```text
install
type-check
lint
unit tests
API tests
build
E2E on staging
deploy
smoke test
```

## Definition of Done

Staging and production deployments are reproducible.

STOP.

---

# 33. M29 — UAT + STABILIZATION

## UAT checklist

Stakeholder verifies:

- CRM flow
- stages
- qualification
- scoring
- AI tone
- knowledge accuracy
- follow-up timing
- takeover
- meeting flow
- dashboard
- permissions
- notifications

## Track bugs

Severity:

```text
P0 critical
P1 high
P2 medium
P3 low
```

Release rule:

- no P0
- no unresolved blocking P1
- P2 documented if deferred

## Definition of Done

Stakeholder signs off on MVP.

STOP.

---

# 34. M30 — PHASE 2 HOOKS

Only after MVP stabilization.

Future modules:

- AI research agent
- Lead Hunter
- outbound prospecting
- campaign builder
- nurture campaigns
- proposal assistance
- advanced AI Sales Manager
- predictive probability
- forecasting
- multi-agent orchestration
- productization / multi-tenancy

Do not let future features complicate MVP implementation prematurely.

---

# 35. TESTING STRATEGY BY LAYER

## Unit tests

Test:

- scoring
- qualification merge
- stage transitions
- follow-up eligibility
- availability
- authorization
- prompt builders
- adapters

## Integration tests

Test:

- API + DB
- event listeners
- BullMQ
- webhook ingestion
- provider adapters with mocks

## End-to-end tests

Use Playwright for major user flows.

## Contract tests

For external providers:

- WhatsApp payload mapping
- AI structured outputs
- calendar mapping

## Regression tests

Every bug fix should add a test where practical.

---

# 36. LOGGING + OBSERVABILITY

Use structured logs.

Include:

- requestId
- correlationId
- userId when safe
- leadId
- conversationId
- jobId
- provider
- action
- outcome
- duration

Never log:

- API secrets
- raw auth tokens
- passwords

Track:

- queue failures
- API failures
- AI latency
- WhatsApp errors
- follow-up failures
- webhook duplicate rate

---

# 37. ERROR HANDLING RULES

Every external adapter must:

- timeout
- normalize errors
- distinguish retryable vs non-retryable
- avoid duplicate send
- produce meaningful audit/event state

Examples:

AI timeout:

```text
do not corrupt qualification
do not create fake empty values
retry only if action is safe
```

WhatsApp failure:

```text
mark outbound FAILED
keep message record
notify/retry
do not duplicate
```

Calendar failure:

```text
keep internal meeting
mark sync failed
retry sync
```

---

# 38. DATA CONSISTENCY RULES

Use transactions for:

- lead + deal stage transitions where needed
- meeting slot booking
- conversation mode + cancellation state where coupled
- important multi-record writes

Use unique constraints for:

- provider message IDs
- external event IDs where relevant
- potentially normalized contact identifiers

Never rely on frontend state for correctness.

---

# 39. CODE QUALITY RULES

Codex must:

- use TypeScript strict mode
- avoid `any` unless justified
- keep functions small
- avoid giant services
- validate external input
- separate provider adapters
- keep DB access out of controllers
- write tests with every important rule
- document architecture decisions
- avoid dead code
- avoid speculative abstraction

---

# 40. CODEX TASK TEMPLATE

Use this template for every milestone:

```text
Read:
- product documentation
- architecture documentation
- folder structure guide
- this implementation playbook

Implement milestone: M__

Scope:
<exact module list>

Do not:
- change unrelated modules
- add unapproved SaaS dependencies
- skip tests
- bypass provider interfaces
- move business state into AI

Required:
1. implement only this milestone
2. add/update migrations if necessary
3. add validation
4. add unit tests
5. add API/integration tests where applicable
6. update docs
7. run type-check
8. run lint
9. run tests
10. summarize changes
11. list assumptions
12. list unresolved risks
13. stop
```

---

# 41. FIRST CODEX PROMPT

```text
Read all project documentation first.

You are implementing the Shilabs AI Sales Engine.

The system must keep CRM, workflow automation, meeting logic, analytics,
knowledge base, lead scoring, pipeline state and audit state in-house.

Do not introduce HubSpot, n8n, Make, Zapier, Calendly, Airtable or Looker Studio.

External providers are allowed only through internal adapters for:
- LLM/AI
- WhatsApp transport
- email transport
- optional external calendar sync

Start with M0 only.

M0 TASK:
- create monorepo
- create web/api/worker packages
- configure TypeScript
- configure lint/format/tests
- create docker-compose with PostgreSQL and Redis
- create .env.example
- create base health endpoints
- create documentation READMEs
- do not implement business modules
- run all available checks
- report files created, commands run, assumptions and concerns
- stop
```

---

# 42. MVP FINAL ACCEPTANCE CHECKLIST

The MVP is complete only when this works:

```text
1. Prospect sends Website/WhatsApp enquiry
2. Contact is matched or created
3. Lead is matched or created
4. Conversation is visible internally
5. AI responds using approved knowledge
6. Qualification updates from evidence
7. Backend calculates lead score
8. Lead moves through internal pipeline
9. Follow-up schedules durably
10. Reply cancels conflicting follow-up
11. Qualified lead can book meeting
12. Human salesperson can take over instantly
13. AI stops sending after takeover
14. AI handoff summary is available
15. Dashboard reflects source-of-truth data
16. All important actions are audited
17. External API failures do not create duplicate or corrupt state
18. Tests pass
19. Security checks pass
20. Staging and production deployment are reproducible
```

---

# 43. IMPORTANT FINAL RULE

Do not optimize for "Codex wrote a lot of code."

Optimize for:

```text
small milestone
→ test
→ inspect
→ verify
→ commit
→ next milestone
```

The project should grow as a sequence of verified working systems, not one giant AI-generated code dump.
