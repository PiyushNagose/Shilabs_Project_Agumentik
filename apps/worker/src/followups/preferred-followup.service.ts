import { LeadPreferredChannel, type DomainEventOutbox, type Prisma } from "@prisma/client";
import { PermanentDomainEventError } from "../domain-events/domain-event.errors.js";
import { workerPrisma } from "../domain-events/domain-event.repository.js";
import { hasProspectInboundAfter } from "../shared/prospect-inbound.js";

export type PreferredFollowUpRoute =
  | { route: "email" }
  | {
      route: "routed";
      channel: "PHONE" | "WHATSAPP";
      status: "QUEUED" | "BLOCKED";
      domainEventId: string | null;
      callingAttemptId: string | null;
    };

export function resolvePreferredFollowUpChannel(lead: {
  contact: { preferredChannel?: string | null };
  intelligence?: { preferredChannel: string } | null;
}): LeadPreferredChannel {
  const preferred = lead.intelligence?.preferredChannel ?? lead.contact.preferredChannel;
  return Object.values(LeadPreferredChannel).find((channel) => channel === preferred) ?? "EMAIL";
}

export async function deferChannelAttemptForPromise(
  event: DomainEventOutbox,
  attemptId: string,
  unsentVoiceCallId?: string
): Promise<boolean> {
  if (!event.workspaceId)
    throw new PermanentDomainEventError("WORKSPACE_CONTEXT_MISSING", "Channel event has no workspace");
  return workerPrisma.$transaction(async (tx) => {
    const attempt = await tx.callingAttempt.findFirst({
      where: { id: attemptId, sequence: { workspaceId: event.workspaceId }, lead: { workspaceId: event.workspaceId } },
      select: { scheduledAt: true, lead: { select: { nextActionAt: true } } }
    });
    if (!attempt)
      throw new PermanentDomainEventError("CALLING_ATTEMPT_NOT_FOUND", "Calling attempt not found in workspace");
    const scheduledAt = new Date(Math.max(attempt.scheduledAt.getTime(), attempt.lead.nextActionAt?.getTime() ?? 0));
    if (scheduledAt.getTime() <= Date.now()) return false;
    const deferred = await tx.domainEventOutbox.updateMany({
      where: { id: event.id, workspaceId: event.workspaceId, status: { in: ["PENDING", "PROCESSING"] } },
      data: {
        status: "PENDING", nextAttemptAt: scheduledAt,
        attempts: Math.max(0, event.attempts - 1),
        queueJobId: null, queuedAt: null, lockedAt: null, lockedBy: null
      }
    });
    if (!deferred.count) return true;
    if (unsentVoiceCallId) {
      // Only this invocation's reservation is known to precede any provider request.
      const released = await tx.voiceCallAttempt.updateMany({
        where: { id: unsentVoiceCallId, providerCallId: null, status: "PROVIDER_PENDING" },
        data: { status: "REQUESTED", failureCode: "VOICE_PROMISE_DEFERRED" }
      });
      if (released.count !== 1) throw new Error("Cannot defer a call with an uncertain provider outcome");
    }
    await tx.callingAttempt.update({
      where: { id: attemptId },
      data: {
        scheduledAt,
        ...(unsentVoiceCallId ? { status: "SCHEDULED", startedAt: null } : {})
      }
    });
    return true;
  });
}

export async function recordPreferredFollowUpAccepted(event: DomainEventOutbox): Promise<void> {
  const payload = event.payload as Prisma.JsonObject;
  const attemptId = payload.followUpAttemptId;
  const channel = payload.preferredChannel;
  if (
    !event.workspaceId ||
    typeof attemptId !== "string" ||
    (channel !== "PHONE" && channel !== "WHATSAPP")
  )
    return;
  await workerPrisma.$transaction(async (tx) => {
    const attempt = await tx.followUpAttempt.findFirst({
      where: {
        id: attemptId,
        status: "SKIPPED",
        failureCode: { in: ["PREFERRED_CHANNEL_ROUTED", "PREFERRED_CHANNEL_ACCEPTED"] },
        sequence: { workspaceId: event.workspaceId, status: "ACTIVE" }
      }
    });
    if (!attempt) return;
    await tx.followUpAttempt.update({
      where: { id: attempt.id },
      data: {
        failureCode: "PREFERRED_CHANNEL_ACCEPTED",
        failureMessage: `${channel} provider accepted the follow-up; no email sent`
      }
    });
    const sequence = await tx.followUpSequence.findUniqueOrThrow({
      where: { id: attempt.sequenceId },
      include: { attempts: { orderBy: { stepIndex: "asc" } } }
    });
    const accepted = (item: (typeof sequence.attempts)[number]): boolean =>
      item.status === "SENT" ||
      (item.status === "SKIPPED" && item.failureCode === "PREFERRED_CHANNEL_ACCEPTED");
    let currentStep = 0;
    for (const item of sequence.attempts) {
      if (!accepted(item)) break;
      currentStep++;
    }
    const complete =
      sequence.attempts.length === sequence.cadenceDays.length && sequence.attempts.every(accepted);
    await tx.followUpSequence.update({
      where: { id: sequence.id },
      data: { currentStep, ...(complete ? { status: "COMPLETED", completedAt: new Date() } : {}) }
    });
    const next = sequence.attempts.find((item) => item.status === "SCHEDULED");
    if (next || complete)
      await tx.lead.updateMany({
        where: {
          id: sequence.leadId,
          workspaceId: event.workspaceId,
          automationOwnershipState: "AI_ACTIVE",
          OR: [{ nextActionAt: null }, { nextActionAt: { lte: new Date() } }]
        },
        data: {
          nextAction: next
            ? `Automatic follow-up ${String(next.stepIndex + 1)} scheduled`
            : "Review completed follow-up schedule",
          nextActionAt: next?.scheduledAt ?? null
        }
      });
  });
}

export async function routePreferredFollowUp(input: {
  event: DomainEventOutbox;
  attemptId: string;
  textBody: string;
  subject?: string;
  env?: NodeJS.ProcessEnv;
}): Promise<PreferredFollowUpRoute> {
  const workspaceId = input.event.workspaceId;
  if (!workspaceId)
    throw new PermanentDomainEventError(
      "WORKSPACE_CONTEXT_MISSING",
      "Follow-up event has no workspace"
    );
  return workerPrisma.$transaction(
    async (tx) => {
      const attempt = await tx.followUpAttempt.findFirst({
        where: { id: input.attemptId, sequence: { workspaceId }, lead: { workspaceId } },
        include: { sequence: true, lead: { include: { intelligence: true, contact: true } } }
      });
      if (!attempt)
        throw new PermanentDomainEventError(
          "FOLLOW_UP_ATTEMPT_NOT_FOUND",
          "Follow-up attempt not found in workspace"
        );
      const key = `preferred-follow-up:${attempt.id}`;
      const existing = await tx.domainEventOutbox.findUnique({ where: { idempotencyKey: key } });
      if (existing) {
        const payload = existing.payload as Prisma.JsonObject;
        return {
          route: "routed",
          channel: payload.preferredChannel as "PHONE" | "WHATSAPP",
          status: "QUEUED",
          domainEventId: existing.id,
          callingAttemptId: existing.aggregateId
        };
      }
      const channel = resolvePreferredFollowUpChannel(attempt.lead);
      if (channel !== "PHONE" && channel !== "WHATSAPP") return { route: "email" };

      const [inbound, takeover, pausedConversation] = await Promise.all([
        hasProspectInboundAfter({ leadId: attempt.leadId, since: attempt.sequence.createdAt }, tx),
        tx.humanTakeover.count({ where: { leadId: attempt.leadId, status: "ACTIVE" } }),
        tx.conversation.count({
          where: { leadId: attempt.leadId, mode: { in: ["HUMAN", "PAUSED", "CLOSED"] } }
        })
      ]);
      const lead = attempt.lead;
      const blocked =
        attempt.sequence.status !== "ACTIVE" ||
        attempt.status !== "SCHEDULED" ||
        Boolean(attempt.outboundEmailId) ||
        lead.contact.doNotContact ||
        ["WON", "LOST", "DISQUALIFIED"].includes(lead.status) ||
        lead.automationOwnershipState !== "AI_ACTIVE" ||
        ["OFF", "PAUSED"].includes(lead.intelligence?.aiControlStatus ?? "") ||
        lead.intelligence?.humanInterventionRequired === true ||
        inbound ||
        takeover > 0 ||
        pausedConversation > 0 ||
        !input.textBody.trim();
      if (blocked) {
        await tx.followUpAttempt.updateMany({
          where: {
            id: attempt.id,
            status: "SCHEDULED",
            outboundEmailId: null
          },
          data: {
            status: "BLOCKED",
            failedAt: new Date(),
            failureCode: "PREFERRED_CHANNEL_ROUTING_BLOCKED",
            failureMessage: "Current lead or follow-up state blocks preferred-channel routing"
          }
        });
        return {
          route: "routed",
          channel,
          status: "BLOCKED",
          domainEventId: null,
          callingAttemptId: null
        };
      }
      const claimed = await tx.followUpAttempt.updateMany({
        where: {
          id: attempt.id,
          status: "SCHEDULED",
          outboundEmailId: null,
          sequence: { status: "ACTIVE" },
          lead: { automationOwnershipState: "AI_ACTIVE", contact: { doNotContact: false } }
        },
        data: {
          status: "SKIPPED",
          textBody: input.textBody,
          subject: input.subject ?? attempt.subject,
          failureCode: "PREFERRED_CHANNEL_ROUTED",
          failureMessage: `Email skipped; ${channel} work queued`,
          zohoSyncStatus: "NOT_REQUIRED"
        }
      });
      if (claimed.count !== 1) {
        // A concurrent worker claimed the email attempt; never fall back to email.
        return {
          route: "routed",
          channel,
          status: "BLOCKED",
          domainEventId: null,
          callingAttemptId: null
        };
      }
      const sequence = await tx.callingSequence.create({
        data: {
          workspaceId,
          leadId: attempt.leadId,
          contactId: attempt.sequence.contactId,
          followUpSequenceId: attempt.sequenceId,
          cadenceOffsets: [0],
          maxAttempts: 1,
          idempotencyKey: key
        }
      });
      const scheduledAt = new Date(Math.max(Date.now(), attempt.scheduledAt.getTime(), lead.nextActionAt?.getTime() ?? 0));
      const calling = await tx.callingAttempt.create({
        data: {
          sequenceId: sequence.id,
          leadId: attempt.leadId,
          contactId: attempt.sequence.contactId,
          attemptIndex: 0,
          scheduledAt,
          idempotencyKey: key
        }
      });
      const event = await tx.domainEventOutbox.create({
        data: {
          workspaceId,
          eventType:
            channel === "PHONE" ? "CALL_AUTOMATION_ATTEMPT_DUE" : "WHATSAPP_SEND_REQUESTED",
          aggregateType: "CallingAttempt",
          aggregateId: calling.id,
          correlationId: input.event.correlationId,
          idempotencyKey: key,
          nextAttemptAt: scheduledAt,
          payload: {
            leadId: attempt.leadId,
            contactId: attempt.sequence.contactId,
            callingAttemptId: calling.id,
            callingSequenceId: sequence.id,
            followUpSequenceId: attempt.sequenceId,
            followUpAttemptId: attempt.id,
            preferredChannel: channel,
            sourceEventId: input.event.id,
            textBody: input.textBody,
            subject: input.subject ?? attempt.subject
          }
        }
      });
      await tx.callingAttempt.update({
        where: { id: calling.id },
        data: { domainEventId: event.id }
      });
      await tx.auditEvent.create({
        data: {
          workspaceId,
          actorType: "SYSTEM",
          entityType: "FollowUpAttempt",
          entityId: attempt.id,
          action: "FOLLOW_UP_PREFERRED_CHANNEL_QUEUED",
          after: {
            channel,
            callingAttemptId: calling.id,
            domainEventId: event.id,
            status: "QUEUED"
          }
        }
      });
      await tx.lead.updateMany({
        where: { id: attempt.leadId, nextActionAt: lead.nextActionAt },
        data: {
          nextAction: lead.nextAction ?? (
            channel === "PHONE"
              ? "Call preferred-channel follow-up queued"
              : "WhatsApp preferred-channel follow-up queued"),
          nextActionAt: calling.scheduledAt
        }
      });
      return {
        route: "routed",
        channel,
        status: "QUEUED",
        domainEventId: event.id,
        callingAttemptId: calling.id
      };
    },
    { maxWait: 10000, timeout: 30000 }
  );
}
