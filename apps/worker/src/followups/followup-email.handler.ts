import type { DomainEventOutbox, Prisma } from "@prisma/client";
import type { DomainEventHandlerMap } from "../domain-events/domain-event.processor.js";
import { PermanentDomainEventError } from "../domain-events/domain-event.errors.js";
import { workerPrisma } from "../domain-events/domain-event.repository.js";
import { getWorkerAwsSesConfig } from "../integrations/aws-ses.config.js";
import { WorkerAwsSesProvider, type WorkerEmailProvider } from "../integrations/aws-ses.provider.js";
import { ZohoTimelineSyncer, type TimelineSyncer } from "./zoho-timeline.syncer.js";

function normalizeEmail(value: string | null): string | null {
  const normalized = value?.trim().toLowerCase() ?? null;
  return normalized && normalized.length > 0 ? normalized : null;
}

function validEmail(value: string | null): value is string {
  return Boolean(value && /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value));
}

function payloadString(event: DomainEventOutbox, key: string): string | null {
  const payload = event.payload as Prisma.JsonObject;
  const value = payload[key];
  return typeof value === "string" ? value : null;
}

function providerErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "Provider operation failed";
}

async function markAttemptFailed(input: {
  attemptId: string;
  status: "BLOCKED" | "FAILED" | "SKIPPED";
  code: string;
  message: string;
}): Promise<void> {
  await workerPrisma.followUpAttempt.update({
    where: { id: input.attemptId },
    data: {
      status: input.status,
      failedAt: new Date(),
      failureCode: input.code,
      failureMessage: input.message
    }
  });
}

async function syncZohoTimelineAfterSend(input: {
  attemptId: string;
  activityId: string;
  env: NodeJS.ProcessEnv;
  timelineSyncer?: TimelineSyncer;
}): Promise<void> {
  const syncer = input.timelineSyncer ?? new ZohoTimelineSyncer(workerPrisma);
  const result = await syncer.syncActivity({ activityId: input.activityId, env: input.env });
  if (result.status === "SYNCED" || result.status === "SKIPPED") {
    await workerPrisma.followUpAttempt.update({
      where: { id: input.attemptId },
      data: {
        zohoSyncStatus: result.status === "SYNCED" ? "SYNCED" : "SYNCED",
        zohoLastError: null
      }
    });
    return;
  }
  await workerPrisma.followUpAttempt.update({
    where: { id: input.attemptId },
    data: {
      zohoSyncStatus: "FAILED",
      zohoLastError: result.lastError
    }
  });
  throw new Error(result.lastError ?? "Zoho timeline sync failed");
}

async function sendFollowUpEmail(input: {
  event: DomainEventOutbox;
  env?: NodeJS.ProcessEnv;
  provider?: WorkerEmailProvider;
  timelineSyncer?: TimelineSyncer;
}): Promise<void> {
  const attemptId = payloadString(input.event, "followUpAttemptId");
  if (!attemptId) {
    throw new PermanentDomainEventError("FOLLOW_UP_ATTEMPT_MISSING", "Follow-up attempt id missing");
  }

  const attempt = await workerPrisma.followUpAttempt.findUnique({
    where: { id: attemptId },
    include: {
      sequence: true,
      lead: { include: { contact: true, conversations: { where: { channel: "EMAIL" }, take: 1 } } }
    }
  });
  if (!attempt) {
    throw new PermanentDomainEventError("FOLLOW_UP_ATTEMPT_NOT_FOUND", "Follow-up attempt not found");
  }
  if (attempt.status === "CANCELLED" || attempt.status === "SKIPPED") return;
  if (attempt.sequence.status !== "ACTIVE") {
    await markAttemptFailed({
      attemptId,
      status: "SKIPPED",
      code: "FOLLOW_UP_SEQUENCE_NOT_ACTIVE",
      message: `Follow-up sequence status is ${attempt.sequence.status}`
    });
    return;
  }
  if (attempt.status !== "SCHEDULED" && attempt.status !== "SENDING" && attempt.status !== "SENT") {
    return;
  }

  const lead = attempt.lead;
  const conversation = lead.conversations[0];
  const normalizedEmail = normalizeEmail(lead.contact.email);
  const suppression = normalizedEmail
    ? await workerPrisma.emailSuppression.findUnique({ where: { normalizedEmail } })
    : null;
  const inboundAfterSequence = await workerPrisma.inboundEmail.count({
    where: { leadId: lead.id, status: "PROCESSED", receivedAt: { gte: attempt.sequence.createdAt } }
  });

  const blocked: [string, string] | null =
    !validEmail(normalizedEmail)
      ? ["CONTACT_EMAIL_INVALID", "Lead contact email is missing or invalid"]
      : lead.contact.doNotContact
        ? ["CONTACT_DO_NOT_CONTACT", "Contact is marked doNotContact"]
        : ["WON", "LOST", "DISQUALIFIED"].includes(lead.status)
          ? ["LEAD_STATUS_FORBIDS_OUTREACH", `Lead status ${lead.status} forbids outreach`]
          : suppression
            ? ["EMAIL_SUPPRESSED", `Email address is suppressed: ${suppression.reason}`]
            : conversation && ["HUMAN", "PAUSED", "CLOSED"].includes(conversation.mode)
              ? ["AUTOMATION_PAUSED", `Conversation mode ${conversation.mode} blocks automation`]
              : inboundAfterSequence > 0
                ? ["INBOUND_REPLY_RECEIVED", "Inbound reply stopped follow-up automation"]
                : null;
  if (blocked) {
    await markAttemptFailed({
      attemptId,
      status: "BLOCKED",
      code: blocked[0],
      message: blocked[1]
    });
    await workerPrisma.followUpSequence.update({
      where: { id: attempt.sequenceId },
      data: { status: "STOPPED", stopReason: blocked[0], stoppedAt: new Date() }
    });
    throw new PermanentDomainEventError(blocked[0], blocked[1]);
  }

  const existing = await workerPrisma.outboundEmail.findUnique({
    where: { idempotencyKey: attempt.idempotencyKey }
  });
  let outbound = existing;
  let activityId: string | null = null;
  const toEmail = lead.contact.email ?? normalizedEmail;
  if (!toEmail || !normalizedEmail) {
    throw new PermanentDomainEventError("CONTACT_EMAIL_INVALID", "Lead contact email is missing");
  }
  if (!outbound) {
    const config = getWorkerAwsSesConfig(input.env);
    outbound = await workerPrisma.outboundEmail.create({
      data: {
        leadId: lead.id,
        contactId: lead.contactId,
        toEmail,
        normalizedToEmail: normalizedEmail,
        fromEmail: config.fromEmail || "not-configured@local.invalid",
        replyToEmail: config.replyToEmail,
        subject: attempt.subject,
        textBody: attempt.textBody,
        provider: "AWS_SES",
        idempotencyKey: attempt.idempotencyKey,
        status: "PENDING"
      }
    });
    await workerPrisma.followUpAttempt.update({
      where: { id: attempt.id },
      data: { status: "SENDING", outboundEmailId: outbound.id }
    });
    const outboundId = outbound.id;
    if (config.status === "NOT_CONFIGURED") {
      await workerPrisma.outboundEmail.update({
        where: { id: outboundId },
        data: {
          status: "FAILED",
          failureCode: "AWS_SES_NOT_CONFIGURED",
          failureMessage: `Missing configuration: ${config.missing.join(", ")}`
        }
      });
      await markAttemptFailed({
        attemptId,
        status: "FAILED",
        code: "AWS_SES_NOT_CONFIGURED",
        message: `Missing configuration: ${config.missing.join(", ")}`
      });
      throw new PermanentDomainEventError(
        "AWS_SES_NOT_CONFIGURED",
        `Missing configuration: ${config.missing.join(", ")}`
      );
    }

    try {
      const provider = input.provider ?? new WorkerAwsSesProvider(config);
      const sent = await provider.sendEmail({
        to: outbound.toEmail,
        from: config.fromEmail,
        replyTo: config.replyToEmail,
        subject: outbound.subject,
        textBody: outbound.textBody ?? attempt.textBody,
        configurationSet: config.configurationSet,
        idempotencyKey: outbound.idempotencyKey
      });
      const now = new Date();
      const result = await workerPrisma.$transaction(
        async (tx) => {
          const updated = await tx.outboundEmail.update({
            where: { id: outboundId },
            data: { status: "SENT", providerMessageId: sent.providerMessageId, sentAt: now }
          });
          const messageConversation =
            conversation ??
            (await tx.conversation.create({
              data: { leadId: lead.id, channel: "EMAIL", mode: "AUTO", status: "OPEN" }
            }));
          await tx.message.create({
            data: {
              conversationId: messageConversation.id,
              providerMessageId: sent.providerMessageId,
              direction: "OUTBOUND",
              senderType: "SYSTEM",
              body: attempt.textBody,
              deliveryStatus: "SENT",
              sentAt: now,
              metadata: { outboundEmailId: updated.id, followUpAttemptId: attempt.id }
            }
          });
          const activity = await tx.activity.create({
            data: {
              leadId: lead.id,
              type: "MESSAGE_SENT",
              description: `Follow-up email sent to ${updated.toEmail}: ${updated.subject}`
            }
          });
          await tx.auditEvent.create({
            data: {
              actorType: "SYSTEM",
              entityType: "FollowUpAttempt",
              entityId: attempt.id,
              action: "FOLLOW_UP_EMAIL_SENT",
              after: { outboundEmailId: updated.id, providerMessageId: sent.providerMessageId }
            }
          });
          await tx.followUpAttempt.update({
            where: { id: attempt.id },
            data: { status: "SENT", sentAt: now, outboundEmailId: updated.id }
          });
          await tx.followUpSequence.update({
            where: { id: attempt.sequenceId },
            data:
              attempt.stepIndex >= attempt.sequence.cadenceDays.length - 1
                ? { status: "COMPLETED", completedAt: now, currentStep: attempt.stepIndex + 1 }
                : { currentStep: attempt.stepIndex + 1 }
          });
          return { updated, activityId: activity.id };
        },
        { maxWait: 10000, timeout: 30000 }
      );
      outbound = result.updated;
      activityId = result.activityId;
    } catch (error) {
      await workerPrisma.outboundEmail.update({
        where: { id: outboundId },
        data: {
          status: "FAILED",
          failureCode: "AWS_SES_SEND_FAILED",
          failureMessage: providerErrorMessage(error)
        }
      });
      await markAttemptFailed({
        attemptId,
        status: "FAILED",
        code: "AWS_SES_SEND_FAILED",
        message: providerErrorMessage(error)
      });
      throw error;
    }
  }

  if (outbound.status !== "SENT") {
    throw new PermanentDomainEventError(
      "OUTBOUND_EMAIL_NOT_SENT",
      `Outbound email status is ${outbound.status}`
    );
  }
  if (attempt.status !== "SENT") {
    await workerPrisma.followUpAttempt.update({
      where: { id: attempt.id },
      data: { status: "SENT", sentAt: outbound.sentAt, outboundEmailId: outbound.id }
    });
  }
  if (!activityId) {
    const activity = await workerPrisma.activity.findFirst({
      where: { leadId: lead.id, description: { contains: outbound.subject } },
      orderBy: { createdAt: "desc" }
    });
    activityId = activity?.id ?? null;
  }
  await syncZohoTimelineAfterSend({
    attemptId,
    activityId: activityId ?? outbound.id,
    env: input.env ?? process.env,
    timelineSyncer: input.timelineSyncer
  });
}

export const followUpDomainEventHandlers: DomainEventHandlerMap = {
  FOLLOWUP_EMAIL_SEND_REQUESTED: {
    handle: (event) => sendFollowUpEmail({ event })
  }
};

export { sendFollowUpEmail };
