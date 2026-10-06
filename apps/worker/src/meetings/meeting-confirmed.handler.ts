import type { DomainEventHandlerMap } from "../domain-events/domain-event.processor.js";
import { PermanentDomainEventError } from "../domain-events/domain-event.errors.js";
import { workerPrisma } from "../domain-events/domain-event.repository.js";
import { ZohoTimelineSyncer } from "../followups/zoho-timeline.syncer.js";

function payloadString(event: { payload: unknown }, key: string): string | null {
  const payload = event.payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const value = (payload as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim() ? value : null;
}

async function syncConfirmedMeeting(event: Parameters<NonNullable<DomainEventHandlerMap["MEETING_CONFIRMED"]>["handle"]>[0]): Promise<void> {
  const activityId = payloadString(event, "activityId");
  if (!activityId) {
    throw new PermanentDomainEventError(
      "MEETING_ACTIVITY_MISSING",
      "Confirmed meeting activity id is missing"
    );
  }

  const syncer = new ZohoTimelineSyncer(workerPrisma);
  const result = await syncer.syncActivity({ activityId, env: process.env });
  await workerPrisma.meetingRequest.update({
    where: { id: event.aggregateId },
    data: {
      zohoSyncStatus: result.status === "SKIPPED" ? "SYNCED" : result.status,
      zohoLastError: result.status === "SYNCED" || result.status === "SKIPPED" ? null : result.lastError
    }
  });

  if (!["SYNCED", "SKIPPED"].includes(result.status)) {
    throw new Error(result.lastError ?? "Zoho meeting timeline sync failed");
  }
}

export const meetingDomainEventHandlers: DomainEventHandlerMap = {
  MEETING_CONFIRMED: { handle: syncConfirmedMeeting }
};
