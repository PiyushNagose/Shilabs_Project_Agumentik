# Deals Module

M5 implements manual deal management backed by PostgreSQL and Prisma.

Current endpoints:

- `POST /api/deals`
- `GET /api/deals/:id`
- `PATCH /api/deals/:id`

Deals are linked one-to-one with leads and linked to a pipeline stage. Deal probability defaults from the selected stage when the request does not provide an explicit value. Deal create/update operations append lead activity records and audit events.

This module must not call external provider SDKs directly.
