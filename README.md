# Shilabs AI Sales Engine

In-house AI Sales Operating System for lead capture, CRM, pipeline, conversations, qualification, scoring, follow-up, meeting booking, dashboarding, analytics and audit history.

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

PostgreSQL is the source of truth. External services must remain behind internal adapters. AI may extract, summarize and generate language, but it must never own authoritative permissions, lead score, pipeline stage, opt-out state, meeting state, workflow state, retry state, delivery state or audit history.
