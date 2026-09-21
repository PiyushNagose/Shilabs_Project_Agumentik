# Integrations Module

External provider adapters belong here and must not own core business state.

R1 adds integration account and external record mapping persistence. These records support
connector idempotency, sync status, retry/error metadata and external ID lookup.

Do not store plaintext provider secrets in these models. Use environment variables or a
secret manager and store only references such as `env:ZOHO_BIGIN_CLIENT_SECRET`.

R5 adds AWS SES as an email provider integration. SES credentials remain environment or
secret-manager values. `IntegrationAccount` records only health/configuration status and
`secretRef` such as `env:AWS_SES_SECRET_ACCESS_KEY` or `aws-default-credential-chain`.
