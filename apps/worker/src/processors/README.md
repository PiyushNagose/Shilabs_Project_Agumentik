# Processors

R12 introduces the domain event processor.

Current behavior:

- internal R11 events are acknowledged without external side effects
- unsupported external action events are moved to `ATTENTION_REQUIRED`
- communication-side-effect event types re-check current lead/contact/conversation state
  before processing

General outbound email actions, calls, WhatsApp, proposals and meetings are intentionally
left for later milestones.

R13 registers `FOLLOWUP_EMAIL_SEND_REQUESTED` as the first production business handler.
It sends persisted first-email/follow-up content through the worker-side `EmailProvider`
adapter only after re-checking current eligibility. Calls, WhatsApp, proposals and
meetings remain later milestones.
