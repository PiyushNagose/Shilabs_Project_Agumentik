# M9 Milestone Report

MILESTONE: M9 - AI Provider Layer

STATUS: PASS (automated milestone checks); live provider verification pending credentials.

IMPLEMENTED:

- Five typed AIProvider methods and OpenAI adapter with validated inputs/outputs.
- Bounded timeouts/retries, sanitized errors/logs, evidence reference validation.
- Real provider factory and test-only MockAIProvider.
- Matching AI settings in real .env and .env.example, preserving existing secrets.

REUSED:

- Zod 4, shared MESSAGE_SENDER_TYPES, AppError, Node fetch, Vitest and workspace configuration.

FILES CREATED:

- apps/api/src/config/ai.ts
- apps/api/src/modules/ai/ai.provider.ts
- apps/api/src/modules/ai/ai.schemas.ts
- apps/api/src/modules/ai/ai.factory.ts
- apps/api/src/modules/ai/**tests**/mock-ai.provider.ts
- apps/api/src/modules/ai/**tests**/ai.provider.test.ts
- apps/api/src/modules/integrations/openai/openai.provider.ts
- docs/architecture/ai-provider.md
- docs/architecture/m9-report.md

FILES MODIFIED:

- .env (ignored local file)
- .env.example
- README.md
- apps/api/src/shared/errors.ts
- apps/api/src/modules/ai/README.md

DATABASE CHANGES: None.

API CHANGES: No endpoints. Added internal provider and retryable-provider error codes.

TESTS ADDED:

- 20 focused cases covering provider substitution/all methods, malformed results, evidence,
  refusals/truncation, invalid inputs/embeddings, errors, retries, timeouts and configuration.

COMMANDS RUN:

- npm run type-check
- npm run lint
- npm test -- apps/api/src/modules/ai/**tests**/ai.provider.test.ts
- npm run build
- npm run format
- Scoped npx prettier --write/--check
- git diff --check; git check-ignore .env
- Read-only repository, documentation and environment-key inspections.

RESULTS:

- Type-check: PASS after correcting the shared constant import.
- Lint: PASS after removing deprecated Zod .finite(); z.number() already rejects infinity.
- Unit/adapter contract tests: PASS, 20/20. Full database suite intentionally not repeated.
- Integration tests: Mocked HTTP adapter coverage passed; live OpenAI not run (key blank).
- Build: PASS. Formatting: PASS. Diff whitespace: PASS.

DEFINITION OF DONE:

- Provider swappable without feature-module changes: PASS.
- Required methods and real adapter: PASS.
- Validation, timeout, safe retries and error mapping: PASS.
- Deterministic test-only mock and no runtime fake fallback: PASS.
- Checks and documentation: PASS.

ASSUMPTIONS:

- Playbook granular milestone order takes precedence over broad plan numbering.
- Context/Input naming normalized to SalesReplyInput.
- M9 defines extraction contracts; M10 owns qualification persistence/merge.

RISKS / OPEN ITEMS:

- User must configure OPENAI_API_KEY in .env and have model access/API billing.
- Live OpenAI model/schema compatibility remains unverified until credentials are supplied.
- Structured validation cannot prove factual truth. Later knowledge/review orchestration remains required.
- No dev servers started. No M10+ functionality implemented.

ARCHITECTURE NOTES:

- Native HTTP adapter stays under integrations; no new dependency or schema migration.
- Configuration validates on provider creation; existing CRM startup stays available without a key.
- See ai-provider.md for transport limits, environment setup and official API references.

SUGGESTED COMMIT: feat(ai): add validated AI provider abstraction and OpenAI adapter

NEXT RECOMMENDED MILESTONE: M10 - Qualification. Await approval.
