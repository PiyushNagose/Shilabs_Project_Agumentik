# ADR-003: Zoho Bigin As CRM System Of Record

## Status

Accepted for revised requirements realignment.

## Context

The original M0-M10 implementation assumed Shilabs PostgreSQL would own the core CRM records for companies, contacts, leads, deals, pipeline and timeline. The revised client requirements change Phase 1 to a connector-first AI sales automation product integrated with the client's existing Zoho Bigin CRM.

The revised documents explicitly state that Zoho Bigin owns CRM identity, CRM pipeline representation and CRM timeline representation. Shilabs owns automation/orchestration state, qualification evidence, proposal approval workflow, integration mappings, retries, audit/history and operator UX context.

## Decision

Zoho Bigin is the Phase 1 CRM system of record.

Shilabs PostgreSQL remains the local system of record for:

- automation and workflow state
- AI qualification and evidence
- follow-up, retry and job state
- proposal draft/review/approval workflow
- external integration mappings and sync status
- local audit/activity history required for orchestration
- operator dashboard context

Existing Company, Contact, Lead, Deal, PipelineStage, Activity and AuditEvent models should not be deleted during R0. R1-R4 must adapt the CRM-like models into local synchronized representations or internal-only records, backed by provider-neutral CRM connector boundaries and Zoho Bigin external record mappings.

## Consequences

- Domain modules must not call Zoho-specific SDKs or APIs directly.
- A provider-neutral `CRMProvider` contract is required before Zoho-specific sync work.
- Local records that mirror CRM entities need external IDs, sync metadata, conflict/error handling and idempotency.
- Frontend CRM workspace wording and behavior must be realigned toward sales automation/operator workflows, not a Zoho replacement.
- Local-only development adapters are acceptable only when clearly labeled and truthfully fail if a real external action cannot be performed.
- No runtime path may pretend that an email, CRM update, WhatsApp message, call, calendar event or proposal send succeeded when the configured provider did not actually perform it.

## Implementation Notes

The immediate next milestone should be R1: CRM Provider Abstraction + Integration Mapping. Destructive migrations are not approved by this ADR.
