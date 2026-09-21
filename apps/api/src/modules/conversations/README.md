# Conversations Module

M7 implements internal conversation state and mode management. M8 adds local simulator support through the same endpoints.

Current endpoints:

- `GET /api/conversations`
- `POST /api/conversations`
- `GET /api/conversations/:id`
- `GET /api/conversations/:id/messages`
- `POST /api/conversations/:id/messages`
- `PATCH /api/conversations/:id/mode`

Conversations are linked to leads and stored in PostgreSQL. Mode changes create audit events. Appended messages create lead activities with `MESSAGE_RECEIVED` or `MESSAGE_SENT` and update the lead's latest activity timestamp in the same database transaction.

External messaging providers and AI response generation are intentionally not used here.
