# Notifications Module

R18 implements the first internal notification path for negotiation handoff alerts.

- `NEGOTIATION_HANDOFF` notifications are persisted locally and routed to the assigned lead owner when available.
- Missing ownership is represented as `ATTENTION_REQUIRED` instead of silently succeeding.
- External notification channels, escalation policy and read/acknowledge workflows remain deferred until the client finalizes notification rules.
