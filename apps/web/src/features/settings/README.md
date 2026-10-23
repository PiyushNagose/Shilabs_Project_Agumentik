# Users and Settings

The `/users` screen lists active workspace members and lets administrators add accounts, change profile details and roles, and deactivate or reactivate access. Sales managers can view the workspace list. User data is restricted to the selected workspace and refreshed by workspace realtime events.

The `/settings` screen lets every administrator update their own profile and manage the persisted lead-scoring weights and thresholds. The scoring configuration uses the existing shared platform configuration API. Email/provider setup remains in Integrations.

User and scoring changes are validated and persisted by the API. API authorization remains the source of truth; hiding a control in the web app is not treated as authorization.
