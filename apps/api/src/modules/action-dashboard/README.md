# Action Dashboard Module

R19 exposes a read-only Sales Engineer Action Dashboard assembled from existing persisted
workflow state. It does not create dashboard-owned business state.

Sources:

- proposals waiting for approval
- internal notifications and negotiation handoffs
- active human takeovers
- persisted failure/attention states from follow-up, proposal sync and domain events

Meeting actions are intentionally reported as not available until the R20/R21 meeting/calendar
milestones create a persisted meeting source.
