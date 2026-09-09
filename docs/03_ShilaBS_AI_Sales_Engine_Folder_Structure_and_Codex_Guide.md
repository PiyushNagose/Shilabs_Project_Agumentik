# Shilabs AI Sales Engine — Folder Structure & Codex Guide

## 1. Repository Strategy

Use a **monorepo** with:
- `web` — React frontend
- `api` — modular monolith backend
- `worker` — background jobs / follow-ups / async AI tasks
- shared packages for types, validation, config and UI
- source-of-truth documentation under `docs/`

Do **not** start with microservices.

## 2. Recommended Folder Structure

```text
shilabs-ai-sales-engine/
|
+-- apps/
|   +-- web/
|   |   +-- src/
|   |       +-- app/
|   |       +-- components/
|   |       +-- features/
|   |       |   +-- auth/
|   |       |   +-- dashboard/
|   |       |   +-- leads/
|   |       |   +-- pipeline/
|   |       |   +-- conversations/
|   |       |   +-- followups/
|   |       |   +-- meetings/
|   |       |   +-- knowledge/
|   |       |   +-- analytics/
|   |       |   +-- settings/
|   |       +-- hooks/
|   |       +-- services/
|   |       +-- store/
|   |       +-- types/
|   |       +-- utils/
|   |
|   +-- api/
|   |   +-- src/
|   |   |   +-- config/
|   |   |   +-- middleware/
|   |   |   +-- modules/
|   |   |   |   +-- auth/
|   |   |   |   +-- users/
|   |   |   |   +-- companies/
|   |   |   |   +-- contacts/
|   |   |   |   +-- leads/
|   |   |   |   +-- deals/
|   |   |   |   +-- pipeline/
|   |   |   |   +-- conversations/
|   |   |   |   +-- messages/
|   |   |   |   +-- qualification/
|   |   |   |   +-- scoring/
|   |   |   |   +-- knowledge/
|   |   |   |   +-- ai/
|   |   |   |   +-- automation/
|   |   |   |   +-- followups/
|   |   |   |   +-- meetings/
|   |   |   |   +-- notifications/
|   |   |   |   +-- analytics/
|   |   |   |   +-- integrations/
|   |   |   |   +-- audit/
|   |   |   +-- events/
|   |   |   +-- shared/
|   |   |   +-- app.ts
|   |   |   +-- server.ts
|   |   +-- prisma/
|   |       +-- schema.prisma
|   |       +-- migrations/
|   |
|   +-- worker/
|       +-- src/
|           +-- processors/
|           +-- queues/
|           +-- schedulers/
|           +-- integrations/
|           +-- worker.ts
|
+-- packages/
|   +-- shared-types/
|   +-- shared-config/
|   +-- ui/
|   +-- validation/
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
+-- package.json
+-- README.md
```

## 3. Standard Backend Module Structure

```text
modules/leads/
  lead.routes.ts
  lead.controller.ts
  lead.service.ts
  lead.repository.ts
  lead.schemas.ts
  lead.types.ts
  lead.events.ts
  lead.permissions.ts
  __tests__/
```

Rules:
- controller = HTTP translation only
- service = business logic
- repository = DB access
- schemas = input/output validation
- events = domain events emitted by module
- permissions = module-level RBAC policy
- provider-specific code belongs under `integrations/`

## 4. In-House Constraint

Do not introduce:
- HubSpot
- n8n
- Make
- Zapier
- Calendly as scheduling core
- Airtable
- Looker Studio

Allowed behind adapters only:
- OpenAI / LLM provider
- Meta WhatsApp Business Platform
- email transport
- optional Google/Microsoft calendar sync
- object storage

## 5. Runtime Architecture

```text
React Web
   |
Express/Fastify API
   |
PostgreSQL + pgvector
   |
Redis
   |
BullMQ Worker
   |
External adapters:
  OpenAI
  WhatsApp
  Email
  Optional Calendar
```

The API owns business state. The worker owns delayed/retryable work. PostgreSQL is the source of truth.

## 6. Core Events

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

Never use `setTimeout` or in-memory timers for business follow-up.

## 7. AI Provider Boundary

```ts
interface AIProvider {
  generateSalesReply(context: SalesReplyContext): Promise<SalesReplyResult>;
  extractQualification(input: QualificationInput): Promise<QualificationResult>;
  summarizeLead(input: LeadSummaryInput): Promise<LeadSummaryResult>;
  generateFollowUp(input: FollowUpInput): Promise<FollowUpResult>;
  createEmbedding(text: string): Promise<number[]>;
}
```

Feature modules must not import the OpenAI SDK directly.

## 8. First Codex Prompt

```text
Read all files under docs/product, docs/architecture and docs/flows first.

Constraints:
- The core CRM, workflow engine, scheduling logic, analytics and knowledge base are in-house.
- Do not introduce HubSpot, n8n, Make, Zapier, Calendly, Airtable or Looker Studio.
- External services are allowed only behind adapters for LLM/AI, WhatsApp transport,
  email transport and optional external calendar sync.
- Use a modular monolith API plus a separate worker.
- PostgreSQL is the source of truth.
- Redis/BullMQ handles durable delayed/retryable jobs.
- AI never owns permissions, lead scores, workflow state, opt-out state, pipeline state or audit history.

TASK 1 ONLY:
1. Review the proposed architecture for contradictions or missing boundaries.
2. Create the monorepo folder structure.
3. Scaffold web, api and worker packages.
4. Add TypeScript/config/lint/test foundations.
5. Add docker-compose for PostgreSQL + Redis.
6. Add .env.example with placeholders only.
7. Add base health-check endpoints.
8. Add README files describing module responsibilities.
9. Do not implement business features yet.
10. Run type-check/lint/tests available at this stage.
11. Report created files, commands, assumptions and architecture concerns.
12. Stop.
```

## 9. Codex Implementation Order

1. Scaffold only
2. Prisma schema + migrations
3. Auth/RBAC/users
4. Companies/contacts/leads
5. Deals/pipeline/activity/audit
6. Conversation/message simulator
7. AI provider + qualification + scoring + knowledge
8. Events + Redis/BullMQ + follow-up automation
9. WhatsApp + human takeover
10. Meetings + optional calendar adapter
11. Dashboard/analytics/notifications
12. E2E tests + security + deployment

## 10. Codex Working Rule

At the end of every task, Codex must:
- run type-check
- run lint
- run tests
- summarize changed files
- state assumptions
- state unresolved risks
- stop

Review the diff before giving the next task.
