# Users Module

M2 owns user management and RBAC support.

Admins can create users, update profiles/roles and set active status. Sales managers can list and read users. Sales reps can read only their own user record.

Routes:

- `GET /api/users`
- `GET /api/users/:id`
- `POST /api/users`
- `PATCH /api/users/:id`
- `PATCH /api/users/:id/status`
