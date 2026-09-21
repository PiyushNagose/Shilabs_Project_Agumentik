MILESTONE:
M11

STATUS:
PASS

IMPLEMENTED:

- Persisted `ScoringConfig` with default factor weights and thresholds.
- Deterministic scoring engine using saved `LeadQualification` only.
- `GET /api/scoring/config`.
- Admin-only `PATCH /api/scoring/config`.
- `POST /api/leads/:id/recalculate-score`.
- Transactional score/temperature update with activity and audit history.

REUSED:

- Existing route/controller/service/repository module pattern.
- Existing auth/RBAC middleware.
- Existing `Lead`, `LeadQualification`, `Activity` and `AuditEvent` models.
- Existing validation middleware and `AppError`.
- Existing shared DTO package.

FILES CREATED:

- `apps/api/prisma/migrations/20260910110000_add_scoring_config/migration.sql`
- `apps/api/src/modules/scoring/scoring.controller.ts`
- `apps/api/src/modules/scoring/scoring.engine.ts`
- `apps/api/src/modules/scoring/scoring.events.ts`
- `apps/api/src/modules/scoring/scoring.repository.ts`
- `apps/api/src/modules/scoring/scoring.routes.ts`
- `apps/api/src/modules/scoring/scoring.schemas.ts`
- `apps/api/src/modules/scoring/scoring.service.ts`
- `apps/api/src/modules/scoring/scoring.api.test.ts`
- `apps/api/src/modules/scoring/scoring.engine.test.ts`
- `docs/architecture/m11-report.md`

FILES MODIFIED:

- `apps/api/prisma/schema.prisma`
- `apps/api/prisma/seed-data.ts`
- `apps/api/prisma/seed.ts`
- `apps/api/src/app.ts`
- `apps/api/src/modules/leads/lead.routes.ts`
- `apps/api/src/modules/scoring/README.md`
- `docs/api/database.md`
- `docs/architecture/README.md`
- `README.md`
- `packages/shared-types/src/index.ts`

DATABASE CHANGES:

- Added `ScoringConfig`.
- Added seeded `default` scoring config.
- Added `SCORE_CHANGED` to `ActivityType`.

API CHANGES:

- Added `GET /api/scoring/config`.
- Added admin-only `PATCH /api/scoring/config`.
- Added `POST /api/leads/:id/recalculate-score`.

TESTS ADDED:

- Scoring engine unit tests for each factor, cap behavior, weak fit and boundary classifications.
- Scoring API tests for auth/RBAC, config validation, score persistence, audit/activity and strict qualification score rejection.

COMMANDS RUN:

- `npm run db:generate`
- `npm run db:migrate -- --name add-scoring-config`
- `npm test -- apps/api/src/modules/scoring/scoring.engine.test.ts apps/api/src/modules/scoring/scoring.api.test.ts`
- `npm test`
- `npm test -- apps/api/src/modules/deals/deal.api.test.ts`
- `npm run type-check`
- `npm run lint`
- `npm run build`
- `npx prettier --check ...`

RESULTS:
Type-check: PASS
Lint: PASS
Unit tests: PASS, 14 engine checks
Integration tests: PASS, 3 API/database-backed checks
Build: PASS
Full test suite: PARTIAL, 97/98 passed; one older M5 login-path failure occurred during the full DB-backed run
Targeted M5 rerun: PASS, 5/5 passed

DEFINITION OF DONE:

- Deterministic scoring independent of AI: PASS
- Configurable weights: PASS
- Configurable thresholds: PASS
- Score explanation returned: PASS
- Exact 59/60/79/80 boundaries tested: PASS
- Recalculation persists score and temperature: PASS
- Config update audited: PASS
- AI cannot directly set score: PASS

ASSUMPTIONS:

- Business fit counts when present unless it clearly says poor/no/weak fit.
- Score explanation is returned by the recalculation API and stored in audit metadata, not as separate lead state.

RISKS / OPEN ITEMS:

- Automatic recalc after qualification update is intentionally not implemented until the event system/automation milestones.
- Manager override and strategic-account rules are future policy work.

ARCHITECTURE NOTES:

- `Lead.score` and `Lead.temperature` remain authoritative application state.
- The scoring engine does not import or call any AI provider.

SUGGESTED COMMIT:
feat(scoring): add deterministic lead scoring and config

NEXT RECOMMENDED MILESTONE:
M12
