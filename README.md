# Shilabs AI Sales Automation

Connector-first AI sales automation layer for Zoho Bigin. Zoho Bigin is the CRM system of
record; this application owns local automation/orchestration state, integration mappings,
qualification evidence, approvals, retries, audit/history and operator workflows.

## M0 Scope

This repository currently contains only the monorepo scaffold:

- React + TypeScript web app in `apps/web`
- Node.js + TypeScript API in `apps/api`
- Node.js + TypeScript worker in `apps/worker`
- Shared packages in `packages/*`
- PostgreSQL and Redis local services in `docker-compose.yml`

Business modules such as CRM, AI, WhatsApp, automation, meetings and analytics are intentionally not implemented in M0.

## Commands

```bash
npm install
npm run db:generate
docker compose up -d
npm run db:migrate
npm run db:seed
npm run dev:web
npm run dev:api
npm run dev:worker
npm run type-check
npm run lint
npm run format
npm test
```

## Local Database

M1 uses PostgreSQL through Prisma. Start local dependencies first:

```bash
docker compose up -d
```

Then run:

```bash
npm run db:generate
npm run db:migrate
npm run db:seed
```

The root scripts load `.env` automatically. The seed creates the canonical pipeline stages and one development-only admin user. Configure the seed with:

- `DATABASE_URL`
- `DEV_ADMIN_EMAIL`
- `DEV_ADMIN_PASSWORD`
- `JWT_SECRET`
- `JWT_ACCESS_TOKEN_TTL_SECONDS`
- `BCRYPT_SALT_ROUNDS`

The default development admin password is for local development only. Set a real local value in `.env`, then run `npm run db:seed`.

M2 adds authentication and user management. Manual developer entry points:

- Web app: `npm run dev:web`, then open `http://localhost:5173`
- API: `npm run dev:api`, then call `http://localhost:4000/health` or `/api/auth/login`
- Worker: `npm run dev:worker` when later queue milestones need it

Local Docker maps PostgreSQL to host port `5433` and Redis to host port `6380` to avoid collisions with developer machines already using the default ports.

## Architecture Rules

PostgreSQL is the Shilabs source of truth for local automation state, not a replacement
CRM. CRM identity, pipeline and timeline state belong to Zoho Bigin in Phase 1. External
services must remain behind internal adapters. AI may extract, summarize and generate
language, but it must never own authoritative permissions, lead score, pipeline stage,
opt-out state, meeting state, workflow state, retry state, delivery state or audit history.

Runtime data must be production-ready: no mock or fake application data should be added to the running product. Automated test fixtures are allowed only inside tests. Development seed data is limited to canonical pipeline configuration and an environment-configured development admin account.

## M5 CRM API

M5 adds manual CRM mechanics backed by PostgreSQL:

- `GET /api/pipeline/stages`
- `PATCH /api/leads/:id/stage`
- `GET /api/leads/:id/activities`
- `POST /api/deals`
- `GET /api/deals/:id`
- `PATCH /api/deals/:id`

Lead stage changes are validated on the server, create lead activity, and create audit events. Closed leads cannot be reopened through the normal stage endpoint. Deals are linked to leads and pipeline stages, with probability defaulting from the selected stage unless explicitly set.

## M6 Frontend CRM

M6 adds the authenticated sales workspace in the web app. After login, users can view real API-backed leads, filter and sort them, inspect lead detail, switch between list and pipeline views, change lead stage, assign owners and read activity history. Later tabs are reserved without fake runtime data.

## M7 Conversations API

M7 adds internal conversation/message persistence backed by PostgreSQL:

- `GET /api/conversations`
- `POST /api/conversations`
- `GET /api/conversations/:id`
- `GET /api/conversations/:id/messages`
- `POST /api/conversations/:id/messages`
- `PATCH /api/conversations/:id/mode`

Messages update `Conversation.lastMessageAt` transactionally. Mode changes create audit events. No WhatsApp, AI response engine, automation, or simulator UI is implemented in M7.

## M8 Internal Conversation Simulator

M8 adds a real API-backed simulator inside the CRM Conversation tab. Developers can start a website conversation for a selected lead, save inbound prospect messages, view the thread, change conversation mode, and see message activity in the lead timeline. The simulator uses the same PostgreSQL conversation/message tables as future channels and does not use mock runtime data, Meta WhatsApp, or AI response generation.

# M9 AI Provider Layer

The AI boundary plus real OpenAI and Gemini adapters are implemented. See
[AI setup and failure behavior](docs/architecture/ai-provider.md).
Set provider keys in the real root `.env`; matching non-secret model/timeout/retry settings
are also in `.env.example`. Free-compatible development currently uses `AI_PROVIDER=gemini`.
No AI messages are sent automatically in M9.
Run focused checks with `npm test -- apps/api/src/modules/ai/__tests__/ai.provider.test.ts`.

# R2 Zoho Bigin Connectivity

R2 adds real OAuth/connectivity plumbing for Zoho Bigin without syncing CRM records yet.
Configure these in the real root `.env` when client credentials are available:

- `ZOHO_BIGIN_CLIENT_ID`
- `ZOHO_BIGIN_CLIENT_SECRET`
- `ZOHO_BIGIN_REFRESH_TOKEN`
- `ZOHO_BIGIN_ACCOUNTS_URL`
- `ZOHO_BIGIN_API_DOMAIN`
- `ZOHO_BIGIN_REQUIRED_SCOPES`

With blank credentials, the API health check reports `NOT_CONFIGURED` truthfully. It does
not fake a connected Zoho state.

Protected health endpoint:

```text
GET /api/integrations/zoho-bigin/health
```

# R3 Zoho Lead/Contact Sync

R3 imports Zoho Bigin contacts into local synchronized company/contact/lead
representations using `ExternalRecordMapping`. It preserves Shilabs-owned automation fields
when CRM data refreshes.

Protected sync endpoint:

```text
POST /api/integrations/zoho-bigin/sync/leads-contacts
```

With blank Zoho credentials, sync returns `NOT_CONFIGURED` and creates no CRM records. It
does not fake a successful provider sync.

# R4 Zoho Deal And Timeline Sync

R4 imports mapped Zoho deal/pipeline records into local synchronized `Deal`
representations and supports idempotent CRM timeline writes for existing local activities.

Protected endpoints:

```text
POST /api/integrations/zoho-bigin/sync/deals
POST /api/integrations/zoho-bigin/timeline/activities/:activityId
```

Timeline mappings are written only after Zoho confirms the external note/activity write.
If Zoho rejects the write, the failure remains visible locally and no successful timeline
mapping is created.

# Local Email For Development

Local development/demo email uses the real Mailpit SMTP service from Docker Compose:

```text
EMAIL_PROVIDER=MAILPIT
MAILPIT_SMTP_HOST=localhost
MAILPIT_SMTP_PORT=1025
MAILPIT_FROM_EMAIL=sales@shilabs.local
MAILPIT_HTTP_URL=http://localhost:8025
```

Mailpit UI/API is available at `http://localhost:8025` after `docker compose up -d`.
Application sends still go through the internal `EmailProvider` boundary and persist
`OutboundEmail` rows; Mailpit is not a fake-success provider.

Production email remains AWS SES. To use SES, set `EMAIL_PROVIDER=AWS_SES` and configure
real SES values in the root `.env`:

- `AWS_SES_REGION`
- `AWS_SES_FROM_EMAIL`
- `AWS_SES_REPLY_TO_EMAIL`
- `AWS_SES_CONFIGURATION_SET`
- `AWS_SES_ACCESS_KEY_ID`
- `AWS_SES_SECRET_ACCESS_KEY`
- `AWS_SES_USE_DEFAULT_CREDENTIAL_CHAIN`
- `AWS_SES_WEBHOOK_SECRET`

As a safety guard, configured AWS SES is blocked in non-production unless
`ALLOW_EXTERNAL_EMAIL_IN_NON_PRODUCTION=true` is explicitly set. Do not enable that flag
for normal development/demo testing.

# R5 AWS SES Email Foundation

R5 adds the provider-neutral email boundary and AWS SES adapter.

Protected endpoints:

```text
GET /api/email/health
POST /api/email/send
```

Signed SES feedback endpoint:

```text
POST /api/email/events
```

Outbound email requests are persisted before sending. The API blocks suppressed addresses,
`doNotContact` contacts and closed/disqualified leads before provider calls. Missing SES
configuration records truthful `FAILED`/`NOT_CONFIGURED` state and never fakes a sent
email. Bounce and complaint feedback updates delivery state and server-side suppression.

# R6 Inbound Email / Reply Ingestion

R6 adds signed inbound SES reply ingestion without adding AI reply understanding or
follow-up automation yet.

Signed inbound endpoint:

```text
POST /api/email/inbound
```

Inbound email is threaded deterministically to a lead/conversation using Shilabs lead or
outbound-email headers first, then exactly one eligible lead matching the sender email. If
matching is missing, ambiguous, mismatched or terminal, the inbound provider event is
persisted as failed state and no message is created by guessing. Successful ingestion
creates/updates an `EMAIL` conversation, stores an inbound `Message`, writes activity/audit
history and marks reply processing as `PENDING` for later reply-engine milestones.

# M11 Lead Scoring

Lead scoring is deterministic and API-owned. Use `GET /api/scoring/config` to inspect the
active weights, admin-only `PATCH /api/scoring/config` to update them, and
`POST /api/leads/:id/recalculate-score` to persist a lead's score from saved qualification
data. AI does not set score or temperature directly.
