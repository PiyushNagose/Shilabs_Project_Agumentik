# Pipeline Module

M5 exposes canonical pipeline stages and lead stage transitions.

Current endpoints:

- `GET /api/pipeline/stages`
- `PATCH /api/leads/:id/stage`

Lead stage changes are validated server-side. Moving from a closed stage back to an open stage is blocked through the normal stage endpoint until a future authorized override is explicitly designed. Each accepted stage change creates an activity record and audit event.

Frontend code must use the API stages instead of hardcoding pipeline business behavior.
