# Email Module

R5 provides the production email foundation only:

- `EmailProvider` is the internal provider boundary.
- `AwsSesProvider` is the first real adapter and lives under `modules/integrations/aws-ses`.
- `MailpitEmailProvider` is the local development/demo SMTP adapter selected with
  `EMAIL_PROVIDER=MAILPIT`.
- `OutboundEmail` persists send intent, SES message ID, status and idempotency.
- `EmailSuppression` blocks future sends server-side.
- SES delivery, bounce and complaint events are ingested through a signed webhook endpoint.

This module does not implement follow-up scheduling, proposal sending, WhatsApp, calling or
automation sequences. Later milestones should reuse this provider and persisted state
instead of creating new email send paths.

R6 adds inbound reply ingestion through the signed `/api/email/inbound` endpoint. Inbound
replies are matched deterministically to an existing lead and `EMAIL` conversation, then
stored as inbound `Message` records with matching `InboundEmail` evidence. Ambiguous or
unmatched replies are persisted as failed inbound state and are not guessed into a lead.

Reply understanding, AI response drafting and follow-up behavior are intentionally left to
later milestones.

R7 adds explicit deliverability and suppression controls:

- `/api/email/pre-send/validate` runs the same server-owned eligibility checks used before
  sends.
- `/api/email/suppressions` lets authorized operators list and upsert real suppression
  records without sending email.
- `/api/email/deliverability/scans` records a durable scan snapshot for contactability
  health. It is the manual/local-first foundation that a later worker schedule can call.

Suppressed, invalid, do-not-contact and terminal lead states are blocked before provider
side effects. A scan may create `INVALID` suppressions for malformed persisted contact
addresses, but it never claims provider delivery success.

E2E setup step 1 adds Mailpit for isolated local email verification. It is a real SMTP
provider adapter, not a fake success path. AWS SES remains the production adapter, and
non-production SES usage requires the explicit `ALLOW_EXTERNAL_EMAIL_IN_NON_PRODUCTION`
opt-in.
