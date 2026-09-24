# Voice Module

R22 adds the provider-neutral voice foundation and a Twilio adapter for local E2E.

- `/api/voice/health` reports truthful `CONFIGURED`, `NOT_CONFIGURED` or `ERROR` state.
- `/api/voice/manual-test-call` is a protected R22-only manual call path for admin/manager E2E.
- `/api/voice/twilio/status` and `/api/voice/twilio/recording` ingest signed Twilio callbacks.
- Call attempts are persisted before provider side effects and updated only after provider-confirmed
  status callbacks.
- Recording/transcript metadata is stored only when explicitly configured; both are disabled by
  default.

R23 builds on this module for automated post-email calling. `VoiceCallAttempt` remains the
provider-attempt evidence record, while `CallingSequence` / `CallingAttempt` own automation
cadence and execution state. Voicemail behavior, WhatsApp, autonomous AI calling and final
calling consent/compliance policy remain outside R22/R23 until the relevant client decisions
are confirmed.
