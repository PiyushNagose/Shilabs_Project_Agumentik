# CRM Module

R1 defines the provider-neutral CRM boundary. Zoho Bigin is the Phase 1 CRM
system of record, but Zoho-specific auth/API behavior begins in R2.

Business modules must depend on `CRMProvider` contracts instead of Zoho SDKs or
Zoho-shaped payloads.
