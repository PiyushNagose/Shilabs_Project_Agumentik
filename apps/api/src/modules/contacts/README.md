# Contacts Module

M3 owns contact CRUD and company-scoped duplicate detection.

Routes:

- `GET /api/contacts`
- `POST /api/contacts`
- `GET /api/contacts/:id`
- `PATCH /api/contacts/:id`

Duplicate checks use normalized email, normalized phone and WhatsApp identity within the selected company. Lead creation and message matching belong to later milestones.

Contact CRM records will be implemented in M3.
