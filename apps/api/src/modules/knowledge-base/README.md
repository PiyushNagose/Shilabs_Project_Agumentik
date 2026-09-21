# Knowledge Base Module

R9 adds governed knowledge storage for later AI and proposal modules.

Knowledge records are versioned and source-backed. Only `APPROVED` entries with an active
approved version are returned by `/api/knowledge-base/approved`, which is the retrieval
surface future AI modules should use. Draft and inactive entries are visible only to
authorized operators through management endpoints.

Human corrections create a new version linked to the previous active version. Corrections
are audited and preserve the older content rather than overwriting it. This module does not
generate AI responses, proposals, embeddings or vector search; those belong to later
milestones.
