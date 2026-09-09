# API App

Modular monolith backend for Shilabs AI Sales Engine.

M0 contains only application bootstrapping and base health endpoints:

- `GET /health`
- `GET /ready`

Future business modules belong under `src/modules/<module>/` with thin routes/controllers, service-level business rules and repository-level data access.
