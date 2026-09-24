# Meetings Module

R21 adds provider-neutral meeting request and human confirmation flows on top of the R20
calendar boundary.

The API persists `MeetingRequest` and `MeetingSlot` rows from real provider availability.
Authorized users can request available slots for a lead and explicitly confirm one slot.
Confirmation re-checks provider availability before creating a calendar meeting, then
persists local confirmation evidence, audit/activity records, a domain event, and a
`GOOGLE_CALENDAR` `ExternalRecordMapping` for the provider event.

Open client decisions intentionally constrain R21:

- customer/party notification semantics remain unresolved, so Google event creation uses
  `sendUpdates=none` and stores a visible `partyNotificationNote`;
- Zoho meeting-object mapping remains unresolved, so confirmed meetings record visible
  `zohoSyncStatus = NOT_CONFIGURED` instead of faking CRM meeting sync;
- meeting confirmation is explicit human/operator confirmation only.
