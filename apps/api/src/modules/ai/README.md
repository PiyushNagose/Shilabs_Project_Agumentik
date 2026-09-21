# AI Module

M9 provides `AIProvider` contracts, Zod input/output schemas and `createAIProvider()`.
Feature modules depend on the interface; composition calls the factory. OpenAI transport
lives in `modules/integrations/openai`. No database writes, routes or automatic replies
are introduced here. Qualification persistence and orchestration remain M10/M13.

`MockAIProvider` lives under `__tests__` and is never selectable in runtime configuration.
Unknown extraction fields are nullable. Evidence quotes/IDs are checked against input.
Contracts intentionally cannot set authoritative CRM state. Callers must supply only
approved knowledge; approval lookup belongs to M12. Schema validity does not prove factual
accuracy, so later orchestration must enforce review and approved-knowledge policies.

See `docs/architecture/ai-provider.md` for configuration and failure behavior.
