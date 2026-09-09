# API Documentation

API contracts belong here as endpoints are implemented milestone by milestone.

Health:

- `GET /health`
- `GET /ready`

M2 authentication:

- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/me`

M2 users:

- `GET /api/users`
- `GET /api/users/:id`
- `POST /api/users`
- `PATCH /api/users/:id`
- `PATCH /api/users/:id/status`

`POST /api/auth/refresh` is intentionally not implemented in M2 because the current approach uses short-lived bearer access tokens backed by server-owned session records. Logout invalidates the session in PostgreSQL.

M3 companies:

- `GET /api/companies`
- `POST /api/companies`
- `GET /api/companies/:id`
- `PATCH /api/companies/:id`

M3 contacts:

- `GET /api/contacts`
- `POST /api/contacts`
- `GET /api/contacts/:id`
- `PATCH /api/contacts/:id`

Company and contact routes require authentication. Duplicate contacts are rejected inside the same company when normalized email, normalized phone or WhatsApp identity matches an existing contact.

M4 leads:

- `POST /api/leads`
- `GET /api/leads`
- `GET /api/leads/:id`
- `PATCH /api/leads/:id`
- `PATCH /api/leads/:id/assign`
- `PATCH /api/leads/:id/status`

Lead list supports pagination, search, source/status/stage/owner/score/temperature filters, and sorting by `createdAt` or `lastActivityAt`. Stage transition APIs are intentionally deferred to M5.
