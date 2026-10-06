# UI Consistency Pass

Completed October 3, 2026.

## Changes

- Dashboard and Operations share `usePersistedResource`: event bursts coalesce,
  requests run serially, one trailing invalidation is retained, and old account
  responses are ignored. Background errors retain existing data with an error notice.
- CRM realtime refresh keeps populated panels mounted. Reconnect also refreshes
  their persisted data. Lead selection and detail requests reject stale responses;
  filtering does not reset the selected lead or active panel.
- Proposal refresh preserves unsaved title, content, correction text and active
  operations. Selecting another proposal invalidates the previous pending fetch.
- Stage/owner responses cannot select a different lead after navigation.
- WebSocket callbacks ignore disposed connections and validate invalidation frames.
  One failing subscriber cannot interrupt delivery to other subscribers.
- Toast timers are cleared on removal and unmount. Navigation respects modifier
  clicks and avoids duplicate history entries for the same URL.
- Dashboard badges wrap based on available card width. Sections no longer stretch
  empty panels to match taller neighbours. Operations retry buttons share existing
  styling. Mobile lead rows retain stage and next action.
- Removed unused panel animation keyframes and the hover transform token. Removed
  panel-wide 3D motion; existing reduced-motion support remains in place.

## Verification

- Type-check and repository lint passed.
- Web test suite: 40 tests passed, including refresh bursts, failed background
  requests, trailing invalidations and account changes.
- Final review separated workspace and list request counters. A filter refresh
  during startup now retains the newer list while allowing stage/user/lead detail
  initialization to finish; covered by a delayed-response regression test.
- Web production build passed.
- Playwright/Edge checked Dashboard, Operations, eight CRM tabs, Users and Settings
  at widths 1440, 768 and 390: 36 combinations, no detected page overflow,
  overflowing buttons/badges, or runtime exceptions.
- Browser checks also assert one dashboard refetch per event burst, preserved
  dashboard DOM and scroll, and preserved proposal edits during realtime refresh.

## Reproduction And Scope

`scripts/browser-ui-audit.cjs` uses fixtures from the web test suite and intercepts
all API traffic. Non-GET API calls fail the audit. Test responses never enter the
application database. Screenshots and results are written beneath the system temp
directory at `shilabs-ui-audit/screenshots`.

Run the web server on port 5174, provide an installed Playwright module via
`PLAYWRIGHT_MODULE` (or install it in the usual module resolution path), then run
`node scripts/browser-ui-audit.cjs`. The runner uses locally installed Edge.

These checks validate frontend rendering and controlled refresh behaviour. They
do not establish live provider health, database correctness, customer delivery,
or end-to-end worker scheduling. No customer calls, messages, bookings or E2E
lead mutations were performed by this pass. Users and Settings remain explicitly
unavailable; this pass does not implement those workflows. There is no supplied
reference design against which to certify literal pixel equivalence.
