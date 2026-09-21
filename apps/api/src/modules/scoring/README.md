# Scoring Module

R8 implements deterministic lead scoring owned by the API. It adapts the old M11 scoring
work to the revised connector-first product: scores help Shilabs prioritize automation and
operator attention, but they do not update Zoho Bigin pipeline state.

Endpoints:

- `GET /api/scoring/config`
- `PATCH /api/scoring/config`
- `POST /api/leads/:id/recalculate-score`
- `PATCH /api/leads/:id/score-override`

The scoring engine reads persisted `LeadQualification` fields and calculates:

- clear requirement
- decision authority
- budget identified
- timeline identified
- strong business fit

Each factor uses the configured weight from `ScoringConfig`. Scores are capped to `0..100`.
Temperature is derived from configured thresholds:

- `HOT`: score >= hot threshold
- `WARM`: score >= warm threshold
- `NURTURE`: below warm threshold

AI never supplies `Lead.score` or `Lead.temperature`. Recalculation updates those fields
transactionally and writes `SCORE_CHANGED` activity plus `LEAD_SCORE_CHANGED` audit history.
Each calculation also creates a `LeadScoreRun` row with factor, config and qualification
snapshots so the decision is explainable later.

Human score overrides are admin/manager-only, require a reason and create
`MANUAL_OVERRIDE` score runs. While an override is active, automatic recalculation records a
`SKIPPED` run and does not overwrite the human-owned score. Knowledge, stage movement,
automation and follow-up behavior remain later milestones.
