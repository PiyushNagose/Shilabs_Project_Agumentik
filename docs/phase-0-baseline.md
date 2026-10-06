# Phase 0 Baseline

Baseline captured on 2026-10-06 before Phase 0 safety changes.

## Repository state

- Baseline commit: `444b8cd` (`Phase 1 Completed Testing in progress`).
- The working tree was materially dirty: 71 tracked files were modified with roughly 4,965
  insertions and 803 deletions before this pass.
- Existing user work was preserved. Phase 0 does not reset, discard, or rewrite that work.

## Important pre-existing untracked runtime files

- `apps/api/src/modules/ai/grounding.ts`
- `apps/api/src/modules/followups/lead-ai-automation.service.ts`
- `apps/api/src/modules/reply-processing/reply-policy.test.ts`
- `apps/api/src/modules/sales-conversation/`
- `apps/web/src/features/leads/CrmWorkspace.realtime.test.ts`
- `apps/web/src/hooks/usePersistedResource.ts` and its test
- `apps/worker/src/meetings/`
- `apps/worker/src/shared/automation-phone.ts`

The master architecture specification and UI audit documentation were also untracked. The
`scratch-db.mjs` file is not production runtime and should be reviewed separately before
checkpointing.

## Reproducible checkpoint

A safe checkpoint must include the pre-existing runtime files above together with their related
tracked changes, all Phase 0 files, Prisma migrations, `package-lock.json`, CI configuration,
and architecture/baseline documentation. Environment files and real credentials must remain
untracked. Before committing, run the isolated test setup described in `.env.test.example`, then:

1. `npm run type-check`
2. `npm run lint`
3. `npm test`
4. `npm run build`

The repository should not be presented as reproducible from `444b8cd` until that complete
checkpoint is committed and the CI workflow passes from a clean clone.
