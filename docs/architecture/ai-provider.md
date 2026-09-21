# M9 AI Provider Boundary

The existing modular monolith remains unchanged. `modules/ai/ai.provider.ts` owns the
vendor-independent interface. `ai.factory.ts` is the composition point; feature services
receive an `AIProvider`. Provider HTTP code lives only in `modules/integrations/openai`
and `modules/integrations/gemini`. Native Node fetch and existing Zod provide transport
and schema conversion, with no new dependency.

The development plan's broad milestone numbering differs from the playbook's granular
numbering; the playbook controls execution. SalesReplyContext/Input are normalized to
SalesReplyInput. The required mock provider is test-only under the user's runtime-data rule.

## Environment

Root commands load the real `.env`. `.env.example` contains placeholders only.
Both files have the same AI setting names; never copy example credentials over real secrets.

| Variable               | Purpose                                                    |
| ---------------------- | ---------------------------------------------------------- |
| AI_PROVIDER            | `gemini` or `openai`; no mock fallback                     |
| GEMINI_API_KEY         | Required when `AI_PROVIDER=gemini`                         |
| GEMINI_MODEL           | `gemini-3.6-flash`, active development chat model          |
| GEMINI_EMBEDDING_MODEL | `gemini-embedding-001`, active development embedding model |
| OPENAI_API_KEY         | Required when `AI_PROVIDER=openai`                         |
| OPENAI_MODEL           | `gpt-4o-mini`, configurable structured-output model        |
| OPENAI_EMBEDDING_MODEL | `text-embedding-3-small`, separate OpenAI embedding model  |
| AI_TIMEOUT_MS          | Total request/retry budget, default 30000; 100 to 120000   |
| AI_MAX_RETRIES         | Additional transient attempts, default 1; 0 to 2           |

For free-compatible local development, create a Google AI Studio API key and set
`AI_PROVIDER=gemini`, `GEMINI_API_KEY`, `GEMINI_MODEL` and `GEMINI_EMBEDDING_MODEL` in
`.env` only. The current verified Gemini chat model is `gemini-3.6-flash`; Google returned
`gemini-2.5-flash` as unavailable to this key for generation.

For OpenAI, create a project API key in the OpenAI platform and set `AI_PROVIDER=openai`
plus `OPENAI_API_KEY` in `.env` only. The project must have API billing and model access.
Never put provider keys in `VITE_` variables. Restart the API after changing environment
values. Configuration is validated when the factory is invoked; M9 does not activate AI in
the conversation UI. Existing CRM startup does not require an AI key yet.

## Reliability

Strict JSON Schema is generated from the same Zod output schemas used for validation.
Gemini receives a provider-compatible schema derived from that same Zod source.
Refusals, truncated completions, unexpected properties, invalid JSON and invalid embeddings
are rejected. No invalid response is persisted. Input size is bounded.

One abort deadline covers HTTP headers, response body and retry delays. Only connection
failures, HTTP 429 and 5xx may retry, with bounded exponential delay/jitter. Authentication,
invalid requests, malformed results and refusals do not retry. Requests only perform inference,
without tools or external writes. A retry can incur additional inference charges.
Delay timers here serve HTTP retries only, never durable business workflows.

Errors map to AppError PROVIDER_ERROR (502) or RETRYABLE_PROVIDER_ERROR (503).
Logs include provider, operation, attempt, duration and transport outcome only. No raw errors,
credentials, prompts or response content are logged. `received` means transport success,
not a claim that model content passed validation. Chat completion storage is disabled.

No schema migration, new endpoint, queue, scoring engine, delivery or workflow mutation is part of M9.
Targeted tests use injected HTTP transport and test-only fixtures; they do not call paid APIs.
Live Gemini verification passed for chat generation and embeddings. Live OpenAI verification
is blocked by API quota until billing/credits are available.

References: [Structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs)
and [embeddings](https://developers.openai.com/api/reference/resources/embeddings/methods/create).
