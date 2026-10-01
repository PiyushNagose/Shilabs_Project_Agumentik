# R29 Security And Compliance Review

R29 hardens the existing R0-R28 implementation without inventing unresolved client
policies.

## Implemented Hardening

- API responses set security headers and disable Express fingerprinting.
- API JSON and webhook form payloads have explicit size limits.
- Auth, general API traffic and webhooks have rate-limit boundaries.
- Error responses and persisted provider failure messages are redacted for secret-looking
  keys and token-like values.
- Provider webhook endpoints remain signature verified and duplicate/replay-safe through
  provider event IDs/idempotency:
  - SES feedback/inbound webhooks require timestamped HMAC signatures.
  - Meta WhatsApp webhooks require `x-hub-signature-256`; provider message/event IDs
    enforce idempotent processing.
  - Twilio webhooks require `x-twilio-signature`; provider call/event IDs enforce
    idempotent processing.
- Development Twilio test TwiML is not exposed in production unless calling consent mode is
  explicitly confirmed.
- Email, WhatsApp and calling flows continue to enforce existing suppression,
  `doNotContact`, terminal lead state, human takeover/pause and provider-configuration
  gates.

## PII Inventory

The application stores CRM-synchronized and automation evidence that can include PII:

- users: names, emails, roles and password hashes
- contacts/leads: names, email addresses, phone/WhatsApp identifiers, company context,
  requirements and notes
- conversations/messages/inbound emails/WhatsApp: customer communication content
- outbound emails/WhatsApp/calls: destination identifiers, delivery status and provider IDs
- proposals, briefings, qualifications and AI runs: customer requirements and derived
  summaries/evidence
- audit/activity/domain events/provider events: operational evidence and failure messages

Provider credentials remain in environment/secret management. Database records use
`secretRef` and non-secret public config only.

## Retention Boundary

Retention/deletion automation is intentionally not implemented in R29. The authoritative
documents leave data minimization, retention and deletion policies to client/compliance
approval. Until those rules are approved, the system preserves audit, workflow and
provider evidence needed for traceability and safe recovery.

## Open Decisions

- OC-02: Whether a No lead can be reactivated and by whom.
- OC-03: Maximum hibernate/follow-up duration and retirement policy.
- OC-04: Duplicate/conflicting human vs AI send arbitration.
- OC-05: Manual takeover resume policy.
- OC-08: WhatsApp template/content and consent policy.
- OC-10: Notification escalation channels and rules.
- OC-12: SES vs Outlook channel routing.
- OC-13: Calling consent/compliance by geography and supported countries.
