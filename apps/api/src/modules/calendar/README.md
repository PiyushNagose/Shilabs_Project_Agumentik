# Calendar Module

R20 adds the provider-neutral calendar boundary used by future meeting scheduling work.

- `/api/calendar/health` reports `CONFIGURED`, `NOT_CONFIGURED`, or `ERROR` truthfully.
- `/api/calendar/availability` validates a timezone-safe availability request and returns no slots unless a real provider adapter is configured.
- R20 intentionally does not create meetings, propose slots, or write CRM timeline entries.

Provider-specific adapters must implement `CalendarProvider` and must never return fake availability.
