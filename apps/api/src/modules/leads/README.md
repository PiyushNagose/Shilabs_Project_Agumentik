# Leads Module

M4 owns manual lead CRUD, list filtering, owner assignment and status updates.

Routes:

- `POST /api/leads`
- `GET /api/leads`
- `GET /api/leads/:id`
- `PATCH /api/leads/:id`
- `PATCH /api/leads/:id/assign`
- `PATCH /api/leads/:id/status`

Lead creation links an existing company and contact, defaults to the `NEW` pipeline stage, and writes audit history. Stage transition mechanics, deals, activity APIs, AI qualification and scoring are intentionally deferred to later milestones.
