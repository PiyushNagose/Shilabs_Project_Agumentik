import { type Prisma } from "@prisma/client";
import { AppError } from "../../shared/errors.js";
import { publishDomainEvent } from "../domain-events/domain-events.service.js";
import { getFollowUpDays } from "./followup-timing.js";

const DAY_MS = 86_400_000;
const CANCELLED_BY_CADENCE = "FOLLOW_UP_CADENCE_CHANGED";
const isAutomaticAction = (action: string | null): boolean =>
  action === "Send first follow-up email" ||
  action?.startsWith("Send follow-up email ") === true ||
  action?.startsWith("Automatic follow-up ") === true;

export async function rescheduleLeadFollowUpsInTransaction(
  tx: Prisma.TransactionClient,
  input: {
    workspaceId: string;
    leadId: string;
    followUpMode: string;
    customCadenceDays: number[];
    actorId: string;
  }
): Promise<void> {
  const lead = await tx.lead.findFirst({
    where: { id: input.leadId, workspaceId: input.workspaceId }
  });
  if (!lead) throw new AppError(404, "NOT_FOUND", "Lead not found");
  const sequences = await tx.followUpSequence.findMany({
    where: {
      leadId: lead.id,
      workspaceId: input.workspaceId,
      status: "ACTIVE",
      cadenceMode: { not: "E2E_ACCELERATED_MINUTES" }
    },
    include: { policy: true, attempts: { orderBy: { stepIndex: "asc" } } }
  });
  if (!sequences.length) return;
  const now = new Date();
  const promisedAt =
    !isAutomaticAction(lead.nextAction) && lead.nextActionAt && lead.nextActionAt > now
      ? lead.nextActionAt
      : null;

  for (const sequence of sequences) {
    if (sequence.attempts.some((attempt) => attempt.status === "SENDING")) {
      throw new AppError(
        409,
        "CONFLICT",
        "A follow-up is being sent. Retry the cadence change shortly."
      );
    }
    const days = getFollowUpDays(
      sequence.policy?.cadenceDays ?? sequence.cadenceDays,
      input.followUpMode,
      input.customCadenceDays
    );
    const nextDays = [...days];
    for (const attempt of sequence.attempts) {
      if (attempt.status === "SENT") {
        while (nextDays.length <= attempt.stepIndex)
          nextDays.push(sequence.cadenceDays[nextDays.length] ?? 0);
        nextDays[attempt.stepIndex] = sequence.cadenceDays[attempt.stepIndex] ?? 0;
      }
    }
    const unsentIndexes = days
      .map((_, index) => index)
      .filter((index) => {
        const attempt = sequence.attempts.find((item) => item.stepIndex === index);
        return (
          !attempt ||
          attempt.status === "SCHEDULED" ||
          (attempt.status === "CANCELLED" && attempt.failureCode === CANCELLED_BY_CADENCE)
        );
      });
    const firstDay = days[unsentIndexes[0] ?? -1];
    const shift =
      firstDay === undefined
        ? 0
        : Math.max(
            0,
            now.getTime() - (sequence.createdAt.getTime() + firstDay * DAY_MS),
            (promisedAt?.getTime() ?? 0) - (sequence.createdAt.getTime() + firstDay * DAY_MS)
          );

    for (const attempt of sequence.attempts.filter((item) => item.status === "SCHEDULED")) {
      const event = attempt.domainEventId
        ? await tx.domainEventOutbox.findFirst({
            where: {
              id: attempt.domainEventId,
              workspaceId: input.workspaceId,
              aggregateId: attempt.id,
              eventType: "FOLLOWUP_EMAIL_SEND_REQUESTED"
            }
          })
        : null;
      if (!event || !["PENDING", "QUEUED"].includes(event.status)) {
        throw new AppError(
          409,
          "CONFLICT",
          "A follow-up event is already processing or unavailable. Retry the cadence change shortly."
        );
      }
      const day = days[attempt.stepIndex];
      const scheduledAt =
        day === undefined
          ? attempt.scheduledAt
          : new Date(sequence.createdAt.getTime() + day * DAY_MS + shift);
      const claimed = await tx.domainEventOutbox.updateMany({
        where: { id: event.id, status: event.status, queueJobId: event.queueJobId },
        data: {
          status: day === undefined ? "PROCESSED" : "PENDING",
          nextAttemptAt: scheduledAt,
          queueJobId: null,
          queueName: null,
          queuedAt: null,
          lockedAt: null,
          lockedBy: null,
          processedAt: day === undefined ? now : null,
          lastErrorCode: day === undefined ? CANCELLED_BY_CADENCE : null,
          lastErrorMessage:
            day === undefined ? "Removed by the lead's follow-up cadence change." : null
        }
      });
      const changed = await tx.followUpAttempt.updateMany({
        where: { id: attempt.id, status: "SCHEDULED" },
        data:
          day === undefined
            ? { status: "CANCELLED", failureCode: CANCELLED_BY_CADENCE }
            : { scheduledAt }
      });
      if (claimed.count !== 1 || changed.count !== 1) {
        throw new AppError(
          409,
          "CONFLICT",
          "Follow-up processing changed concurrently. Retry the cadence change."
        );
      }
    }

    for (const index of unsentIndexes) {
      const existing = sequence.attempts.find((attempt) => attempt.stepIndex === index);
      if (existing?.status === "SCHEDULED") continue;
      const scheduledAt = new Date(
        sequence.createdAt.getTime() + (days[index] ?? 0) * DAY_MS + shift
      );
      const attempt = existing
        ? await tx.followUpAttempt.update({
            where: { id: existing.id },
            data: { status: "SCHEDULED", scheduledAt, failureCode: null, failedAt: null }
          })
        : await tx.followUpAttempt.create({
            data: {
              leadId: lead.id,
              sequenceId: sequence.id,
              stepIndex: index,
              kind: index === 0 ? "FIRST_EMAIL" : "FOLLOW_UP",
              scheduledAt,
              subject: sequence.attempts[0]?.subject ?? "Following up",
              textBody: "",
              idempotencyKey: `follow-up-attempt:${sequence.id}:${String(index)}`
            }
          });
      const event = await publishDomainEvent({
        client: tx,
        eventType: "FOLLOWUP_EMAIL_SEND_REQUESTED",
        aggregateType: "FollowUpAttempt",
        aggregateId: attempt.id,
        correlationId: sequence.id,
        idempotencyKey: `domain-event:follow-up-attempt:${attempt.id}:cadence:${String(now.getTime())}`,
        nextAttemptAt: scheduledAt,
        payload: {
          followUpSequenceId: sequence.id,
          followUpAttemptId: attempt.id,
          leadId: lead.id,
          conversationId: sequence.conversationId,
          stepIndex: index
        }
      });
      await tx.followUpAttempt.update({
        where: { id: attempt.id },
        data: { domainEventId: event.id }
      });
    }
    await tx.followUpSequence.update({
      where: { id: sequence.id },
      data: {
        cadenceDays: nextDays,
        cadenceOffsetsMinutes: nextDays.map((day) => day * 24 * 60),
        ...(unsentIndexes.length === 0 ? { status: "COMPLETED", completedAt: now } : {})
      }
    });
    await tx.auditEvent.create({
      data: {
        workspaceId: input.workspaceId,
        actorType: "USER",
        actorId: input.actorId,
        entityType: "FollowUpSequence",
        entityId: sequence.id,
        action: "FOLLOW_UP_CADENCE_CHANGED",
        before: { cadenceDays: sequence.cadenceDays },
        after: { cadenceDays: nextDays, followUpMode: input.followUpMode }
      }
    });
  }

  const next = await tx.followUpAttempt.findFirst({
    where: {
      leadId: lead.id,
      status: "SCHEDULED",
      sequence: { workspaceId: input.workspaceId, status: "ACTIVE" }
    },
    orderBy: [{ scheduledAt: "asc" }, { stepIndex: "asc" }]
  });
  if (!promisedAt && (next || isAutomaticAction(lead.nextAction))) {
    await tx.lead.update({
      where: { id: lead.id },
      data: {
        nextAction: next
          ? next.stepIndex === 0
            ? "Send first follow-up email"
            : `Send follow-up email ${String(next.stepIndex + 1)}`
          : null,
        nextActionAt: next?.scheduledAt ?? null
      }
    });
  }
}
