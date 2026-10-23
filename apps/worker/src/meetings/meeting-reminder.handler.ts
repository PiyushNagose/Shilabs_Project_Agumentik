import { Prisma, type DomainEventOutbox } from "@prisma/client";
import { PermanentDomainEventError } from "../domain-events/domain-event.errors.js";
import { workerPrisma } from "../domain-events/domain-event.repository.js";
import { publishWorkerRealtimeEvent } from "../realtime/realtime.publisher.js";

export async function handleMeetingReminder(event: DomainEventOutbox): Promise<void> {
  const payload = event.payload;
  const selectedSlotId =
    payload && typeof payload === "object" && !Array.isArray(payload)
      ? payload.selectedSlotId
      : null;
  if (
    event.eventType !== "MEETING_REMINDER_DUE" ||
    event.aggregateType !== "MeetingRequest" ||
    !event.workspaceId ||
    typeof selectedSlotId !== "string" ||
    !selectedSlotId.trim()
  ) {
    throw new PermanentDomainEventError(
      "MEETING_REMINDER_INVALID",
      "Invalid meeting reminder event"
    );
  }
  const workspaceId = event.workspaceId;

  const reminder = await workerPrisma.$transaction(
    async (tx) => {
      const request = await tx.meetingRequest.findFirst({
        where: { id: event.aggregateId, workspaceId },
        include: { slots: { where: { id: selectedSlotId, status: "SELECTED" } } }
      });
      if (
        request?.status !== "CONFIRMED" ||
        request.completedAt ||
        request.reminderMinutes === 0 ||
        request.selectedSlotId !== selectedSlotId
      )
        return null;

      const slot = request.slots[0];
      const now = new Date();
      if (!slot || slot.endsAt.getTime() <= now.getTime()) {
        return null;
      }
      if (now.getTime() < slot.startsAt.getTime() - request.reminderMinutes * 60_000) {
        throw new Error("Meeting reminder is not due yet");
      }

      // Claim and notification commit together; concurrent reschedules invalidate this snapshot.
      if (!request.reminderSentAt) {
        const claimed = await tx.meetingRequest.updateMany({
          where: {
            id: request.id,
            workspaceId,
            status: "CONFIRMED",
            selectedSlotId,
            completedAt: null,
            reminderSentAt: null,
            updatedAt: request.updatedAt
          },
          data: { reminderSentAt: now }
        });
        if (claimed.count !== 1) return null;

        const idempotencyKey = `notification:meeting-reminder:${workspaceId}:${request.id}:${slot.id}:${slot.startsAt.toISOString()}`;
        const startsAt = new Intl.DateTimeFormat("en-US", {
          timeZone: request.timeZone,
          year: "numeric",
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
          timeZoneName: "short"
        }).format(slot.startsAt);
        await tx.internalNotification.upsert({
          where: { idempotencyKey },
          create: {
            workspaceId,
            type: "MEETING_CONFIRMATION",
            status: "UNREAD",
            severity: "INFO",
            title: `Meeting reminder: ${request.title}`,
            body: `${request.title} starts at ${startsAt}.`,
            assignedToUserId: request.ownerId ?? request.requestedByUserId,
            leadId: request.leadId,
            conversationId: request.conversationId,
            meetingRequestId: request.id,
            sourceEntityType: "MeetingRequest",
            sourceEntityId: request.id,
            idempotencyKey
          },
          update: {}
        });
      }
      return { leadId: request.leadId, conversationId: request.conversationId };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
  );

  if (!reminder) return;
  // Replays can repeat invalidation after a crash without creating another notification.
  const realtimeEvent = { ...event, payload: reminder };
  await publishWorkerRealtimeEvent({
    event: realtimeEvent,
    action: "meeting-reminder-created",
    entityType: "notifications",
    env: process.env
  });
  await publishWorkerRealtimeEvent({
    event: realtimeEvent,
    action: "meeting-reminder-sent",
    entityType: "meeting",
    env: process.env
  });
}
