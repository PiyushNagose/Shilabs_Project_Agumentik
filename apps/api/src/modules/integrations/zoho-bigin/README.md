# Zoho Bigin Integration

R2 implements Zoho Bigin authentication and connectivity only.

Runtime behavior:

- Missing OAuth credentials reports `NOT_CONFIGURED`.
- Configured credentials are verified through real OAuth refresh and a lightweight Bigin
  API request.
- Token values are not stored in PostgreSQL.
- `IntegrationAccount.secretRef` stores only the environment/secret reference.
- Lead/contact/deal/timeline synchronization starts in R3/R4.
- R3 imports contacts from the configured contacts module and maps them to local
  company/contact/lead representations.
- R4 imports mapped deal/pipeline records and appends local activities to Zoho timeline
  only after Zoho confirms the write.

Official Bigin OAuth docs require domain-specific accounts URLs and form-data token
requests. API requests use `Authorization: Zoho-oauthtoken <access_token>`.
