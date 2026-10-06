# Phase 0 Baseline and Safety Report

Completed 2026-10-06 against baseline commit `444b8cd`.

## A. Baseline assessment

The repository already had a material, user-owned working tree before Phase 0: 71 tracked files
were modified (about 4,965 insertions and 803 deletions), and multiple runtime modules were
untracked. No existing work was discarded. The complete pre-change inventory and checkpoint
guidance are in `docs/phase-0-baseline.md`.

The untracked runtime modules that must be included in the next checkpoint are the AI grounding,
lead automation, sales conversation, persisted-resource/realtime, worker meeting, and automation
phone modules listed in that baseline. The architecture specification, lockfile, Phase 0 scripts,
and CI workflow must be committed with them. Real environment files and credentials must remain
untracked.

## B. Exact Phase 0 files changed

Configuration and documentation:

- `.env.example`
- `.env.test.example`
- `.gitignore`
- `.github/workflows/ci.yml`
- `README.md`
- `package.json`
- `package-lock.json`
- `apps/api/package.json`
- `packages/shared-config/src/index.ts`
- `vitest.config.ts`
- `scripts/run-tests.cjs`
- `scripts/verify-test-environment.cjs`
- `scripts/vitest-global-setup.ts`
- `docs/phase-0-baseline.md`
- `docs/phase-0-implementation-report.md`

Voice security:

- `apps/api/src/modules/voice/voice.controller.ts`
- `apps/api/src/modules/voice/voice.provider.ts`
- `apps/api/src/modules/voice/voice.service.ts`
- `apps/api/src/modules/voice/voice-ai.service.ts`
- `apps/api/src/modules/voice/voice-ai.realtime.ts`
- `apps/api/src/modules/voice/voice.api.test.ts`
- `apps/api/src/modules/voice/voice.provider.test.ts`
- `apps/api/src/modules/voice/voice-ai.service.test.ts`
- `apps/worker/src/integrations/twilio-voice.provider.ts`
- `apps/worker/src/integrations/twilio-voice.provider.test.ts`
- `packages/shared-config/src/voice-security.test.ts`
- `packages/shared-config/src/test-environment-guard.test.ts`

Authorization:

- `apps/api/src/modules/authorization/crm-record.permissions.ts`
- `apps/api/src/modules/authorization/crm-object-authorization.api.test.ts`
- `apps/api/src/modules/companies/company.controller.ts`
- `apps/api/src/modules/companies/company.repository.ts`
- `apps/api/src/modules/companies/company.service.ts`
- `apps/api/src/modules/contacts/contact.controller.ts`
- `apps/api/src/modules/contacts/contact.repository.ts`
- `apps/api/src/modules/contacts/contact.service.ts`
- `apps/api/src/modules/deals/deal.controller.ts`
- `apps/api/src/modules/deals/deal.service.ts`
- `apps/api/src/modules/conversations/conversation.controller.ts`
- `apps/api/src/modules/conversations/conversation.service.ts`
- `apps/api/src/modules/leads/lead.service.ts`

Events, realtime, tests, and lifecycle:

- `apps/api/src/modules/domain-events/domain-events.service.ts`
- `apps/api/src/modules/domain-events/domain-events.service.test.ts`
- `apps/worker/src/domain-events/domain-event.dispatcher.ts`
- `apps/worker/src/domain-events/domain-event.worker.test.ts`
- `apps/api/src/modules/realtime/realtime.service.ts`
- `apps/api/src/config/database.integration.test.ts`
- `apps/api/src/modules/reply-processing/reply-processing.service.test.ts`
- `apps/api/src/shared/readiness.ts`
- `apps/api/src/app.ts`
- `apps/api/src/app.test.ts`
- `apps/api/src/server.ts`
- `apps/worker/src/runtime.ts`
- `apps/worker/src/worker.ts`

The ignored local `.env.e2e.local` was also given a non-production `EXOTEL_WEBHOOK_SECRET` so the
existing local E2E call flow remains usable. It must not be committed.

## C. Security fixes

- Exotel status and voicebot bootstrap endpoints now require a timing-safe shared-secret check.
- Provider callback URLs carry the credential only to Shilabs-owned endpoints. Arbitrary external
  Exotel app URLs are not modified with the secret.
- Voice stream WebSocket URLs now use short-lived HMAC credentials with nonce and expiry instead
  of exposing the reusable signing secret.
- Invalid callback/bootstrap requests return `401` before business state is read or changed.
- Company, contact, deal, conversation, message, and parent-linked lead access now follows the
  existing ADMIN / SALES_MANAGER / assigned SALES_REP visibility model.

## D. Queue and event correctness

- Dispatch atomically reserves an outbox event as `QUEUED` before `queue.add`, so a fast worker
  cannot observe a persisted `PENDING` event.
- If queue insertion fails, stale queued-event recovery remains the repair path; job IDs and
  idempotency semantics are preserved.
- Manual retry accepts only `FAILED` and `ATTENTION_REQUIRED`, uses an atomic status predicate,
  clears stale execution metadata, resets attempts, and audits the operator action.
- Realtime publication is suppressed while using a transaction client. Transactional events are
  invalidated from the persisted worker path after commit; HTTP remains the source of truth.

## E. Authorization fixes

Reusable company/contact visibility and access assertions are centralized in
`crm-record.permissions.ts`. Repositories accept scoped filters, services enforce access rather
than relying on controllers, and deal/conversation operations authorize through their parent
lead. Lead creation cannot attach a salesperson to inaccessible company/contact records.

## F. Test isolation and CI

- `npm test` now requires `NODE_ENV=test`, an explicit `TEST_DATABASE_URL`, an exact
  `DATABASE_URL` match, a PostgreSQL database name containing a distinct `test` segment, and a
  local host unless remote test use is explicitly opted in.
- Vitest also executes the guard through global setup, preventing direct-run bypass.
- Tests run serially against the isolated database. Order-dependent outbox and proposal fixtures
  were made deterministic.
- CI provisions PostgreSQL 16 and Redis 7, migrates and seeds the test database, then runs
  typecheck, lint, and the full test suite without live external-provider credentials.

## G. Verification results

- `npm run type-check`: passed.
- `npm run lint`: passed with zero errors.
- `npm run build`: passed for API, web, worker, and shared packages.
- Focused Phase 0 suite: 54/54 tests passed.
- Full isolated suite: 356 passed, 1 skipped, 0 failed across 71 files. The skipped test is the
  opt-in live Mailpit E2E test; mocked/local provider contract coverage passed.
- Migrations: all 36 migrations applied to local `shilabs_test`; canonical seed completed.
- `npm audit`: 0 known vulnerabilities after non-breaking transitive lockfile updates.

The full suite covered lead autostart, follow-ups, outbound/inbound email, inbound WhatsApp, reply
processing, qualification/scoring, proposals, meetings, voice, DNC, human takeover, and realtime
lead updates.

## H. Remaining risks and blockers

- No live Exotel, Twilio, Zoho, Google Calendar, SES, or Meta provider call was made in this pass.
  Provider adapters and authenticated request shapes were verified with fakes.
- The repository still needs a complete checkpoint commit because substantial runtime work
  predates Phase 0 and remains uncommitted/untracked.
- Two existing React tests emit `act(...)` warnings while passing. They are test-harness debt, not
  a runtime failure.

## I. Behavior intentionally not changed

No workspace tenancy, workspace RBAC redesign, new CRM screens, agents, workflows, orders, tasks,
multi-instance realtime redesign, or deployment infrastructure was added. Existing provider
semantics, approval gates, DNC, human takeover, follow-up cadence, and HTTP-as-source-of-truth
behavior were preserved.

## J. Close recommendation

Phase 0 implementation is safe to close from a code and local verification perspective. Phase 1
can begin after the complete dirty-tree checkpoint is committed and CI passes from a clean clone.
Production rollout must configure a strong `EXOTEL_WEBHOOK_SECRET` and retain the existing voice
stream signing secret; live provider smoke tests remain a deployment gate, not an automated-test
requirement.
