# Auth Module

M2 owns in-house authentication boundaries:

- password hashing and verification
- login rate limiting
- signed access tokens
- PostgreSQL-backed session invalidation
- current user lookup
- logout

Routes:

- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/me`
