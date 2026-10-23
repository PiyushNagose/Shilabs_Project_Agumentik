import type { DomainEventOutbox, Prisma } from "@prisma/client";
import type { DomainEventHandlerMap } from "../domain-events/domain-event.processor.js";
import { PermanentDomainEventError } from "../domain-events/domain-event.errors.js";
import { workerPrisma } from "../domain-events/domain-event.repository.js";
import { assertWorkspaceIntegrationEnabled } from "../integrations/integration-guard.js";
import {
  WorkerAwsSesProvider,
  type WorkerEmailProvider
} from "../integrations/aws-ses.provider.js";
import { getWorkerSelectedEmailConfig } from "../integrations/email.config.js";
import { WorkerMailpitProvider } from "../integrations/mailpit.provider.js";
import { ZohoTimelineSyncer, type TimelineSyncer } from "./zoho-timeline.syncer.js";
import { scheduleCallingSequenceAfterFailedEmailSequence } from "../calling/calling-automation.service.js";
import { requestFollowUpDraft, type PrepareFollowUpDraft } from "./followup-draft.client.js";
import { hasProspectInboundAfter } from "../shared/prospect-inbound.js";
import { resolvePreferredFollowUpChannel, routePreferredFollowUp } from "./preferred-followup.service.js";

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

function buildWorkerEmailProvider(
  config: ReturnType<typeof getWorkerSelectedEmailConfig>
): WorkerEmailProvider {
  if (config.provider === "MAILPIT") return new WorkerMailpitProvider(config);
  return new WorkerAwsSesProvider(config);
}

function followUpLeadNextAction(attempt: { stepIndex: number; scheduledAt: Date }): {
  nextAction: string;
  nextActionAt: Date;
} {
  return {
    nextAction:
      attempt.stepIndex === 0
        ? "Send first follow-up email"
        : `Send follow-up email ${String(attempt.stepIndex + 1)}`,
    nextActionAt: attempt.scheduledAt
  };
}

function isFollowUpLeadAction(value: string | null): boolean {
  return (
    value === "Send first follow-up email" ||
    value?.startsWith("Send follow-up email ") === true ||
    value?.startsWith("Automatic follow-up ") === true
  );
}

async function syncLeadNextActionForFollowUpSequence(sequenceId: string): Promise<void> {
  const sequence = await workerPrisma.followUpSequence.findUnique({
    where: { id: sequenceId },
    include: {
      lead: { select: { id: true, nextAction: true } },
      attempts: {
        where: { status: { in: ["SCHEDULED", "SENDING"] } },
        orderBy: [{ scheduledAt: "asc" }, { stepIndex: "asc" }]
      }
    }
  });
  if (!sequence) return;

  const nextAttempt = sequence.status === "ACTIVE" ? sequence.attempts[0] : null;
  if (nextAttempt) {
    await workerPrisma.lead.update({
      where: { id: sequence.leadId },
      data: followUpLeadNextAction(nextAttempt)
    });
    return;
  }

  if (isFollowUpLeadAction(sequence.lead.nextAction)) {
    await workerPrisma.lead.update({
      where: { id: sequence.leadId },
      data: { nextAction: null, nextActionAt: null }
    });
  }
}

async function markAttemptFailed(input: {
  attemptId: string;
  status: "BLOCKED" | "FAILED" | "SKIPPED";
  code: string;
  message: string;
}): Promise<void> {
  const attempt = await workerPrisma.followUpAttempt.update({
    where: { id: input.attemptId },
    data: {
      status: input.status,
      failedAt: new Date(),
      failureCode: input.code,
      failureMessage: input.message
    }
  });
  await syncLeadNextActionForFollowUpSequence(attempt.sequenceId);
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

async function reconcileFollowUpSequenceAfterSend(input: {
  sequenceId: string;
  env: NodeJS.ProcessEnv;
}): Promise<void> {
  const sequence = await workerPrisma.followUpSequence.findUnique({
    where: { id: input.sequenceId },
    include: { attempts: { orderBy: { stepIndex: "asc" } } }
  });
  if (sequence?.status !== "ACTIVE") return;

  const requiredSteps = sequence.cadenceDays.length;
  const requiredAttempts = Array.from({ length: requiredSteps }, (_, index) =>
    sequence.attempts.find((attempt) => attempt.stepIndex === index)
  );
  let contiguousSentSteps = 0;
  for (const attempt of requiredAttempts) {
    if (attempt?.status !== "SENT") break;
    contiguousSentSteps += 1;
  }

  const allRequiredAttemptsSent = requiredAttempts.every((attempt) => attempt?.status === "SENT");

  // Secondary CRM timeline sync retries independently after the email is confirmed sent.
  if (!allRequiredAttemptsSent) {
    await workerPrisma.followUpSequence.updateMany({
      where: { id: sequence.id, status: "ACTIVE" },
      data: { currentStep: contiguousSentSteps }
    });
    await syncLeadNextActionForFollowUpSequence(sequence.id);
    return;
  }

  const now = new Date();
  const updated = await workerPrisma.followUpSequence.updateMany({
    where: { id: sequence.id, status: "ACTIVE" },
    data: { status: "COMPLETED", completedAt: now, currentStep: requiredSteps }
  });
  if (updated.count === 1) {
    await scheduleCallingSequenceAfterFailedEmailSequence({
      followUpSequenceId: sequence.id,
      env: input.env
    });
    await syncLeadNextActionForFollowUpSequence(sequence.id);
  }
}

async function sendFollowUpEmail(input: {
  event: DomainEventOutbox;
  env?: NodeJS.ProcessEnv;
  provider?: WorkerEmailProvider;
  timelineSyncer?: TimelineSyncer;
  prepareDraft?: PrepareFollowUpDraft;
}): Promise<void> {
  const eventWorkspaceId = input.event.workspaceId;
  if (!eventWorkspaceId) {
    throw new PermanentDomainEventError(
      "WORKSPACE_CONTEXT_MISSING",
      "Follow-up event has no persisted workspace"
    );
  }
  const attemptId = payloadString(input.event, "followUpAttemptId");
  if (!attemptId) {
    throw new PermanentDomainEventError(
      "FOLLOW_UP_ATTEMPT_MISSING",
      "Follow-up attempt id missing"
    );
  }

  const attempt = await workerPrisma.followUpAttempt.findFirst({
    where: { id: attemptId, sequence: { workspaceId: eventWorkspaceId } },
    include: {
      sequence: true,
      lead: {
        include: {
          contact: true,
          intelligence: true,
          conversations: { where: { channel: "EMAIL" }, take: 1 }
        }
      }
    }
  });
  if (!attempt) {
    throw new PermanentDomainEventError(
      "FOLLOW_UP_ATTEMPT_NOT_FOUND",
      "Follow-up attempt not found"
    );
  }
  if (attempt.status === "CANCELLED" || attempt.status === "SKIPPED") return;
  if (
    attempt.status === "BLOCKED" &&
    attempt.failureCode === "FOLLOW_UP_REQUIRES_REVIEW" &&
    attempt.sequence.status === "ATTENTION_REQUIRED"
  ) return;
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
  const inboundAfterSequence = await hasProspectInboundAfter({
    leadId: lead.id,
    since: attempt.sequence.createdAt
  });
  const activeTakeover = await workerPrisma.humanTakeover.findFirst({
    where: {
      status: "ACTIVE",
      OR: [{ leadId: lead.id }, ...(conversation ? [{ conversationId: conversation.id }] : [])]
    },
    select: { id: true }
  });

  const prefersEmail = !["PHONE", "WHATSAPP"].includes(
    resolvePreferredFollowUpChannel(lead)
  );
  const blocked: [string, string] | null =
    prefersEmail && !validEmail(normalizedEmail)
      ? ["CONTACT_EMAIL_INVALID", "Lead contact email is missing or invalid"]
      : lead.contact.doNotContact
        ? ["CONTACT_DO_NOT_CONTACT", "Contact is marked doNotContact"]
        : ["WON", "LOST", "DISQUALIFIED"].includes(lead.status)
          ? ["LEAD_STATUS_FORBIDS_OUTREACH", `Lead status ${lead.status} forbids outreach`]
          : lead.automationOwnershipState !== "AI_ACTIVE"
            ? [
                "AI_OWNERSHIP_INACTIVE",
                `Lead automation ownership is ${lead.automationOwnershipState}`
              ]
            : lead.intelligence?.aiControlStatus === "OFF"
              ? ["AI_CONTROL_OFF", "Lead-level AI is switched off"]
              : lead.intelligence?.aiControlStatus === "PAUSED"
                ? ["AI_CONTROL_PAUSED", "Lead-level AI is paused"]
                : lead.intelligence?.humanInterventionRequired
                  ? [
                      "HUMAN_INTERVENTION_REQUIRED",
                      "Lead-level controls require human intervention"
                    ]
                  : prefersEmail && suppression
                    ? ["EMAIL_SUPPRESSED", `Email address is suppressed: ${suppression.reason}`]
                    : conversation && ["HUMAN", "PAUSED", "CLOSED"].includes(conversation.mode)
                      ? [
                          "AUTOMATION_PAUSED",
                          `Conversation mode ${conversation.mode} blocks automation`
                        ]
                      : activeTakeover
                        ? ["HUMAN_TAKEOVER_ACTIVE", "Human takeover blocks follow-up automation"]
                        : inboundAfterSequence
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
  if (!outbound) {
    const deferIfNeeded = async (waitUntil?: string): Promise<boolean> =>
      workerPrisma.$transaction(async (tx) => {
        const current = await tx.followUpAttempt.findFirst({
          where: {
            id: attemptId,
            status: "SCHEDULED",
            sequence: { workspaceId: eventWorkspaceId, status: "ACTIVE" },
            lead: { workspaceId: eventWorkspaceId, automationOwnershipState: "AI_ACTIVE" }
          },
          include: { sequence: true, lead: true }
        });
        if (!current) return true;
        const scheduledAt = new Date(Math.max(
          current.scheduledAt.getTime(),
          current.lead.nextActionAt?.getTime() ?? 0,
          waitUntil ? new Date(waitUntil).getTime() : 0
        ));
        if (scheduledAt.getTime() <= Date.now()) return false;
        const changed = await tx.followUpAttempt.updateMany({
          where: { id: attemptId, status: "SCHEDULED", sequence: { status: "ACTIVE" } },
          data: { scheduledAt }
        });
        if (!changed.count) return true;
        await tx.domainEventOutbox.updateMany({
          where: { id: input.event.id, status: { in: ["PENDING", "PROCESSING"] } },
          data: {
            status: "PENDING",
            nextAttemptAt: scheduledAt,
            attempts: Math.max(0, input.event.attempts - 1),
            queueJobId: null,
            queuedAt: null,
            lockedAt: null,
            lockedBy: null
          }
        });
        await tx.lead.updateMany({
          where: { id: lead.id, nextActionAt: current.lead.nextActionAt },
          data: { nextActionAt: scheduledAt }
        });
        return true;
      });
    const draft = await (input.prepareDraft ?? ((value) => requestFollowUpDraft(value, input.env)))(
      {
        workspaceId: eventWorkspaceId,
        attemptId
      }
    );
    if ("waitUntil" in draft) {
      await deferIfNeeded(draft.waitUntil);
      return;
    }
    if (await deferIfNeeded()) return;
    const preferred = await routePreferredFollowUp({
      event: input.event,
      attemptId,
      textBody: draft.textBody,
      subject: draft.subject,
      env: input.env
    });
    if (preferred.route === "routed") return;
    if (!toEmail || !normalizedEmail) {
      throw new PermanentDomainEventError("CONTACT_EMAIL_INVALID", "Lead contact email is missing");
    }
    // Generation can take time. Re-read ownership and inbound activity before reserving a send.
    const current = await workerPrisma.followUpAttempt.findFirst({
      where: {
        id: attemptId,
        status: "SCHEDULED",
        sequence: { status: "ACTIVE", workspaceId: eventWorkspaceId },
        lead: {
          workspaceId: eventWorkspaceId,
          automationOwnershipState: "AI_ACTIVE",
          status: { notIn: ["WON", "LOST", "DISQUALIFIED"] },
          contact: { doNotContact: false },
          OR: [
            { intelligence: { is: null } },
            {
              intelligence: {
                is: {
                  aiControlStatus: { notIn: ["OFF", "PAUSED"] },
                  humanInterventionRequired: false
                }
              }
            }
          ],
          conversations: { none: { mode: { in: ["HUMAN", "PAUSED", "CLOSED"] } } }
        }
      },
      select: { id: true }
    });
    const [newInbound, newTakeover, newSuppression] = await Promise.all([
      hasProspectInboundAfter({ leadId: lead.id, since: attempt.sequence.createdAt }),
      workerPrisma.humanTakeover.count({ where: { leadId: lead.id, status: "ACTIVE" } }),
      workerPrisma.emailSuppression.findUnique({ where: { normalizedEmail } })
    ]);
    if (!current || newInbound || newTakeover > 0 || newSuppression) {
      await markAttemptFailed({
        attemptId,
        status: "BLOCKED",
        code: "LEAD_CHANGED_DURING_PREPARATION",
        message: "Automatic follow-up stopped because the lead changed while preparing the message."
      });
      return;
    }
    attempt.textBody = draft.textBody;
    attempt.subject = draft.subject;
    const config = getWorkerSelectedEmailConfig(input.env);
    const reserved = await workerPrisma.$transaction(async (tx) => {
      const claimed = await tx.followUpAttempt.updateMany({
        where: {
          id: attemptId,
          status: "SCHEDULED",
          sequence: { status: "ACTIVE" },
          lead: {
            automationOwnershipState: "AI_ACTIVE",
            contact: { doNotContact: false },
            OR: [{ nextActionAt: null }, { nextActionAt: { lte: new Date() } }]
          }
        },
        data: { ...draft, status: "SENDING" }
      });
      if (claimed.count !== 1) return null;
      const previousEmail = await tx.outboundEmail.findFirst({
        where: {
          workspaceId: eventWorkspaceId,
          leadId: lead.id,
          status: "SENT",
          senderType: { in: ["USER", "AI"] }
        },
        orderBy: { sentAt: "desc" },
        select: { threadId: true, providerMessageId: true, providerReferences: true }
      });
      const threadId = previousEmail?.threadId ?? conversation?.id ?? null;
      const inReplyTo = previousEmail?.providerMessageId ?? null;
      const references = [
        ...new Set([
          ...(previousEmail?.providerReferences ?? []),
          ...(inReplyTo ? [inReplyTo] : [])
        ])
      ].slice(-20);
      const created = await tx.outboundEmail.create({
        data: {
          workspaceId: eventWorkspaceId,
          leadId: lead.id,
          contactId: lead.contactId,
          toEmail,
          normalizedToEmail: normalizedEmail,
          fromEmail: config.fromEmail || "not-configured@local.invalid",
          replyToEmail: config.replyToEmail,
          subject: attempt.subject,
          textBody: attempt.textBody,
          threadId,
          inReplyTo,
          providerReferences: references,
          senderType: "AI",
          deliveryStatus: "PENDING",
          provider: config.provider,
          idempotencyKey: attempt.idempotencyKey,
          status: "PENDING"
        }
      });
      await tx.followUpAttempt.update({
        where: { id: attempt.id },
        data: { status: "SENDING", outboundEmailId: created.id }
      });
      return created;
    });
    if (!reserved) {
      await deferIfNeeded();
      return;
    }
    outbound = reserved;
    const outboundId = outbound.id;
    if (config.status === "NOT_CONFIGURED") {
      const failureCode = `${config.provider}_NOT_CONFIGURED`;
      await workerPrisma.outboundEmail.update({
        where: { id: outboundId },
        data: {
          status: "FAILED",
          failureCode,
          failureMessage: `Missing configuration: ${config.missing.join(", ")}`
        }
      });
      await markAttemptFailed({
        attemptId,
        status: "FAILED",
        code: failureCode,
        message: `Missing configuration: ${config.missing.join(", ")}`
      });
      throw new PermanentDomainEventError(
        failureCode,
        `Missing configuration: ${config.missing.join(", ")}`
      );
    }

    try {
      await assertWorkspaceIntegrationEnabled({
        workspaceId: eventWorkspaceId,
        provider: config.provider,
        key: "default"
      });
      const provider = input.provider ?? buildWorkerEmailProvider(config);
      const sent = await provider.sendEmail({
        to: outbound.toEmail,
        from: config.fromEmail,
        replyTo: config.replyToEmail,
        subject: outbound.subject,
        textBody: outbound.textBody ?? attempt.textBody,
        threadId: outbound.threadId,
        inReplyTo: outbound.inReplyTo,
        references: outbound.providerReferences,
        configurationSet: config.provider === "AWS_SES" ? config.configurationSet : null,
        idempotencyKey: outbound.idempotencyKey
      });
      const now = new Date();
      const result = await workerPrisma.$transaction(
        async (tx) => {
          const updated = await tx.outboundEmail.update({
            where: { id: outboundId },
            data: {
              status: "SENT",
              deliveryStatus: "SENT",
              providerMessageId: sent.providerMessageId,
              sentAt: now
            }
          });
          const messageConversation =
            conversation ??
            (await tx.conversation.create({
              data: {
                workspaceId: eventWorkspaceId,
                leadId: lead.id,
                channel: "EMAIL",
                mode: "AUTO",
                status: "OPEN"
              }
            }));
          await tx.message.create({
            data: {
              workspaceId: eventWorkspaceId,
              conversationId: messageConversation.id,
              providerMessageId: sent.providerMessageId,
              direction: "OUTBOUND",
              senderType: "AI",
              body: attempt.textBody,
              deliveryStatus: "SENT",
              sentAt: now,
              metadata: { outboundEmailId: updated.id, followUpAttemptId: attempt.id }
            }
          });
          const activity = await tx.activity.create({
            data: {
              workspaceId: eventWorkspaceId,
              leadId: lead.id,
              type: "MESSAGE_SENT",
              description: `Follow-up email sent to ${updated.toEmail}: ${updated.subject}`
            }
          });
          await tx.lead.update({
            where: { id: lead.id },
            data: { lastActivityAt: now }
          });
          await tx.auditEvent.create({
            data: {
              workspaceId: eventWorkspaceId,
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
          return { updated, activityId: activity.id };
        },
        { maxWait: 10000, timeout: 30000 }
      );
      outbound = result.updated;
      activityId = result.activityId;
    } catch (error) {
      const failureCode = `${config.provider}_SEND_FAILED`;
      await workerPrisma.outboundEmail.update({
        where: { id: outboundId },
        data: {
          status: "FAILED",
          failureCode,
          failureMessage: providerErrorMessage(error)
        }
      });
      await markAttemptFailed({
        attemptId,
        status: "FAILED",
        code: failureCode,
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
  await reconcileFollowUpSequenceAfterSend({
    sequenceId: attempt.sequenceId,
    env: input.env ?? process.env
  });
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
