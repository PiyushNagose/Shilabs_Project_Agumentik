# Proposals Module

R14 owns the local proposal workflow and approval gate.

- Zoho Bigin remains the CRM system of record for CRM identity and deal context.
- PostgreSQL owns proposal drafts, versions, approval evidence, edit history and status changes.
- Proposal generation and real proposal sending are intentionally deferred to later milestones.
- A proposal cannot be marked sent unless it is approved and a provider-confirmed sent outbound email already exists.
- Rejection/regeneration is not implemented because the client policy is still open.

R15 adds proposal generation runs:

- General proposal generation uses persisted lead/deal/conversation context plus approved knowledge.
- SEO proposal generation requires SEMrush configuration through `SEODataProvider`.
- Web/design generation records missing brand/design fields instead of inventing them.
- Successful generated proposals are created as drafts and immediately moved to `WAITING_APPROVAL`.
- No generated proposal is sent in this module.

R16 adds approved proposal sending and review support:

- `/api/proposals/:id/send` sends only `APPROVED` proposals through `EmailProvider`.
- A proposal moves to `SENT` only after the outbound email is provider-confirmed as `SENT`.
- The resulting `PROPOSAL_SENT` activity is synced to Zoho Bigin through the existing
  timeline connector after local sent state is persisted.
- Failed or missing Zoho configuration is stored on the proposal and can be retried
  without sending the email again.
