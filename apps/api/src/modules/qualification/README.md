# Qualification Module

M10 stores structured sales qualification for a lead.

Endpoints are mounted under leads:

- `GET /api/leads/:id/qualification`
- `PATCH /api/leads/:id/qualification`
- `POST /api/leads/:id/qualification/recalculate`

Qualification fields are nullable when unknown. AI recalculation uses the `AIProvider`
interface and recent persisted conversation messages. Human corrections use the same
validation and persistence path. Evidence is stored as rows linked to real `Message`
records; each quote must be present in the referenced saved message.

This module does not calculate lead score, move stages, send replies, schedule follow-ups
or retrieve knowledge. Those behaviors belong to later milestones.
