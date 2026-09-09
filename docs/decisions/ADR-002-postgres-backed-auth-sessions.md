# ADR-002: PostgreSQL-Backed Auth Sessions

## Status

Accepted

## Context

M2 requires authentication, session creation and session invalidation while the application remains the source of truth for users, roles and permissions.

## Decision

Access tokens are signed by the API and include a server-side session identifier. Each active session is stored in PostgreSQL as `AuthSession` with a hashed token value, expiry and optional revocation timestamp.

Protected routes verify both the token signature and the session row, then re-read the active user before authorizing access.

## Consequences

Logout can invalidate a token immediately by revoking the session record. Disabled users cannot continue authenticating through stale sessions because protected routes require the associated user to remain active.

This adds one M2 database table, but avoids outsourcing auth/session state and keeps permissions authoritative inside the application.
