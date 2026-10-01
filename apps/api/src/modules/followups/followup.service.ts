import { Prisma } from "@prisma/client";
import type { FollowUpAttemptDto, FollowUpSequenceDto } from "@shilabs/shared-types";
import { getFollowUpTimingConfig } from "@shilabs/shared-config";
import { AppError } from "../../shared/errors.js";
import { prisma } from "../../shared/prisma.js";
import type { AuthenticatedUser } from "../auth/auth.types.js";
import { createAIProvider } from "../ai/ai.factory.js";
import type { AIProvider } from "../ai/ai.provider.js";
import { listApprovedKnowledge } from "../knowledge-base/knowledge-base.service.js";
import { publishDomainEvent } from "../domain-events/domain-events.service.js";
import { validateOutboundEmailPreSend } from "../email/email.service.js";
import type { StartFollowUpSequenceInput } from "./followup.schemas.js";

const DEFAULT_CADENCE_DAYS = [0, 1, 5, 9] as const;
const FOLLOW_UP_CADENCE_MODES = {
  production_days: "PRODUCTION_DAYS",
  e2e_accelerated_minutes: "E2E_ACCELERATED_MINUTES"
} as const;

type SequenceRecord = Prisma.FollowUpSequenceGetPayload<{ include: { attempts: true } }>;

interface StartOptions {
  provider?: AIProvider;
  env?: NodeJS.ProcessEnv;
  now?: Date;
}

function toAttemptDto(attempt: SequenceRecord["attempts"][number]): FollowUpAttemptDto {
  return {
    id: attempt.id,
    sequenceId: attempt.sequenceId,
    leadId: attempt.leadId,
    stepIndex: attempt.stepIndex,
    kind: attempt.kind,
    status: attempt.status,
    scheduledAt: attempt.scheduledAt.toISOString(),
    subject: attempt.subject,
    idempotencyKey: attempt.idempotencyKey,
    domainEventId: attempt.domainEventId,
    outboundEmailId: attempt.outboundEmailId,
    zohoSyncStatus: attempt.zohoSyncStatus,
    zohoLastError: attempt.zohoLastError,
    sentAt: attempt.sentAt?.toISOString() ?? null,
    failedAt: attempt.failedAt?.toISOString() ?? null,
    failureCode: attempt.failureCode,
    failureMessage: attempt.failureMessage,
    createdAt: attempt.createdAt.toISOString(),
    updatedAt: attempt.updatedAt.toISOString()
  };
}

function toSequenceDto(
  sequence: SequenceRecord,
  e2eAccelerationEligible = false
): FollowUpSequenceDto {
  return {
    id: sequence.id,
    leadId: sequence.leadId,
    contactId: sequence.contactId,
    conversationId: sequence.conversationId,
    status: sequence.status,
    cadenceDays: sequence.cadenceDays,
    cadenceMode: sequence.cadenceMode,
    cadenceOffsetsMinutes: sequence.cadenceOffsetsMinutes,
    e2eAccelerationEligible,
    currentStep: sequence.currentStep,
    stopReason: sequence.stopReason,
    stoppedAt: sequence.stoppedAt?.toISOString() ?? null,
    completedAt: sequence.completedAt?.toISOString() ?? null,
    lastErrorCode: sequence.lastErrorCode,
    lastErrorMessage: sequence.lastErrorMessage,
    idempotencyKey: sequence.idempotencyKey,
    attempts: sequence.attempts
      .sort((a, b) => a.stepIndex - b.stepIndex)
      .map(toAttemptDto),
    createdAt: sequence.createdAt.toISOString(),
    updatedAt: sequence.updatedAt.toISOString()
  };
}

async function isE2EAccelerationEligible(sequence: SequenceRecord): Promise<boolean> {
  if (sequence.status !== "ACTIVE" || sequence.cadenceMode === "E2E_ACCELERATED_MINUTES") {
    return false;
  }

  const scheduledAttempts = sequence.attempts.filter((attempt) => attempt.status === "SCHEDULED");
  if (scheduledAttempts.length === 0) {
    return false;
  }

  const eventIds = scheduledAttempts.map((attempt) => attempt.domainEventId).filter(Boolean) as string[];
  if (eventIds.length !== scheduledAttempts.length) {
    return false;
  }

  const pendingEvents = await prisma.domainEventOutbox.count({
    where: {
      id: { in: eventIds },
      status: "PENDING"
    }
  });
  return pendingEvents === eventIds.length;
}

function scheduleAt(now: Date, offsetMinutes: number): Date {
  return new Date(now.getTime() + offsetMinutes * 60 * 1000);
}

function subjectFor(input: {
  stepIndex: number;
  serviceInterest: string | null;
  requirement: string | null;
}): string {
  const topic = input.serviceInterest ?? input.requirement ?? "your Shilabs project";
  return input.stepIndex === 0 ? `Following up about ${topic}` : `Quick follow-up about ${topic}`;
}

async function loadSequence(id: string): Promise<FollowUpSequenceDto> {
  const sequence = await prisma.followUpSequence.findUniqueOrThrow({
    where: { id },
    include: { attempts: true }
  });
  return toSequenceDto(sequence, await isE2EAccelerationEligible(sequence));
}

export async function listFollowUpSequencesForLead(
  leadId: string
): Promise<FollowUpSequenceDto[]> {
  const sequences = await prisma.followUpSequence.findMany({
    where: { leadId },
    include: { attempts: true },
    orderBy: { createdAt: "desc" }
  });
  return Promise.all(
    sequences.map(async (sequence) =>
      toSequenceDto(sequence, await isE2EAccelerationEligible(sequence))
    )
  );
}

async function createAttentionSequence(input: {
  leadId: string;
  contactId: string;
  conversationId: string | null;
  idempotencyKey: string;
  code: string;
  message: string;
}): Promise<FollowUpSequenceDto> {
  const sequence = await prisma.followUpSequence.upsert({
    where: { idempotencyKey: input.idempotencyKey },
    create: {
      leadId: input.leadId,
      contactId: input.contactId,
      conversationId: input.conversationId,
      status: "ATTENTION_REQUIRED",
      cadenceDays: [...DEFAULT_CADENCE_DAYS],
      cadenceMode: FOLLOW_UP_CADENCE_MODES.production_days,
      cadenceOffsetsMinutes: DEFAULT_CADENCE_DAYS.map((day) => day * 24 * 60),
      idempotencyKey: input.idempotencyKey,
      lastErrorCode: input.code,
      lastErrorMessage: input.message
    },
    update: {},
    include: { attempts: true }
  });
  return toSequenceDto(sequence, await isE2EAccelerationEligible(sequence));
}

export async function startFollowUpSequence(
  actor: AuthenticatedUser,
  leadId: string,
  input: StartFollowUpSequenceInput,
  options?: StartOptions
): Promise<FollowUpSequenceDto> {
  const idempotencyKey = input.idempotencyKey ?? `follow-up:lead:${leadId}`;
  const existing = await prisma.followUpSequence.findUnique({
    where: { idempotencyKey },
    include: { attempts: true }
  });
  if (existing) return loadSequence(existing.id);

  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    include: {
      company: true,
      contact: true,
      qualification: true,
      conversations: { where: { channel: "EMAIL" }, orderBy: { createdAt: "desc" }, take: 1 }
    }
  });
  if (!lead) throw new AppError(404, "NOT_FOUND", "Lead not found");

  const eligibility = await validateOutboundEmailPreSend(actor, { leadId });
  if (!eligibility.allowed) {
    return createAttentionSequence({
      leadId,
      contactId: lead.contactId,
      conversationId: lead.conversations[0]?.id ?? null,
      idempotencyKey,
      code: eligibility.code ?? "FOLLOW_UP_BLOCKED",
      message: eligibility.message ?? "Follow-up automation is blocked"
    });
  }
  const conversation = lead.conversations[0];
  if (conversation && ["HUMAN", "PAUSED", "CLOSED"].includes(conversation.mode)) {
    return createAttentionSequence({
      leadId,
      contactId: lead.contactId,
      conversationId: conversation.id,
      idempotencyKey,
      code: "CONVERSATION_NOT_AUTOMATED",
      message: `Conversation mode ${conversation.mode} blocks follow-up automation`
    });
  }
  const activeTakeover = await prisma.humanTakeover.findFirst({
    where: {
      leadId,
      status: "ACTIVE",
      conversationId: conversation?.id
    },
    select: { id: true }
  });
  if (activeTakeover) {
    return createAttentionSequence({
      leadId,
      contactId: lead.contactId,
      conversationId: conversation?.id ?? null,
      idempotencyKey,
      code: "HUMAN_TAKEOVER_ACTIVE",
      message: "Human takeover blocks follow-up automation"
    });
  }

  const approvedKnowledge = await listApprovedKnowledge({ limit: 20 });
  const timing = getFollowUpTimingConfig(options?.env);
  const messages = conversation
    ? await prisma.message.findMany({
        where: { conversationId: conversation.id },
        select: { id: true, senderType: true, body: true },
        orderBy: { createdAt: "asc" },
        take: 50
      })
    : [];
  const now = options?.now ?? new Date();
  const drafts: string[] = [];
  try {
    const provider = options?.provider ?? createAIProvider(options?.env);
    for (const [index, day] of DEFAULT_CADENCE_DAYS.entries()) {
      const output = await provider.generateFollowUp({
        messages,
        approvedKnowledge: approvedKnowledge.map((item) => ({
          id: item.versionId,
          content: item.content
        })),
        leadContext: JSON.stringify({
          stepIndex: index,
          cadenceDay: day,
          cadenceMode: timing.mode,
          cadenceOffsetMinutes: timing.offsetsMinutes[index],
          leadId: lead.id,
          company: lead.company.name,
          contact: `${lead.contact.firstName} ${lead.contact.lastName}`.trim(),
          requirement: lead.requirement,
          serviceInterest: lead.serviceInterest,
          qualification: lead.qualification
        })
      });
      drafts.push(output.body);
    }
  } catch (error) {
    return createAttentionSequence({
      leadId,
      contactId: lead.contactId,
      conversationId: conversation?.id ?? null,
      idempotencyKey,
      code: "AI_FOLLOW_UP_DRAFT_FAILED",
      message: error instanceof Error ? error.message : "AI follow-up draft generation failed"
    });
  }

  const sequence = await prisma.$transaction(
    async (tx) => {
      const emailConversation =
        conversation ??
        (await tx.conversation.create({
          data: { leadId, channel: "EMAIL", mode: "AUTO", status: "OPEN" }
        }));
      const created = await tx.followUpSequence.create({
        data: {
          leadId,
          contactId: lead.contactId,
          conversationId: emailConversation.id,
          cadenceDays: [...DEFAULT_CADENCE_DAYS],
          cadenceMode: FOLLOW_UP_CADENCE_MODES[timing.mode],
          cadenceOffsetsMinutes: timing.offsetsMinutes,
          idempotencyKey
        }
      });

    for (const [index, day] of DEFAULT_CADENCE_DAYS.entries()) {
      const scheduledAt = scheduleAt(now, timing.offsetsMinutes[index] ?? day * 24 * 60);
      const attempt = await tx.followUpAttempt.create({
        data: {
          sequenceId: created.id,
          leadId,
          stepIndex: index,
          kind: index === 0 ? "FIRST_EMAIL" : "FOLLOW_UP",
          scheduledAt,
          subject: subjectFor({
            stepIndex: index,
            serviceInterest: lead.serviceInterest,
            requirement: lead.requirement
          }),
          textBody: drafts[index] ?? "",
          idempotencyKey: `follow-up-attempt:${created.id}:${String(index)}`
        }
      });
      const event = await publishDomainEvent({
        client: tx,
        eventType: "FOLLOWUP_EMAIL_SEND_REQUESTED",
        aggregateType: "FollowUpAttempt",
        aggregateId: attempt.id,
        correlationId: created.id,
        idempotencyKey: `domain-event:follow-up-attempt:${attempt.id}`,
        nextAttemptAt: scheduledAt,
        payload: {
          followUpSequenceId: created.id,
          followUpAttemptId: attempt.id,
          leadId,
          conversationId: emailConversation.id,
          stepIndex: index
        }
      });
      await tx.followUpAttempt.update({
        where: { id: attempt.id },
        data: { domainEventId: event.id }
      });
    }

    await tx.auditEvent.create({
      data: {
        actorType: "USER",
        actorId: actor.id,
        entityType: "FollowUpSequence",
        entityId: created.id,
        action: "FOLLOW_UP_SEQUENCE_STARTED",
        after: {
          leadId,
          cadenceDays: [...DEFAULT_CADENCE_DAYS],
          cadenceMode: FOLLOW_UP_CADENCE_MODES[timing.mode],
          cadenceOffsetsMinutes: timing.offsetsMinutes
        }
      }
    });

      return created;
    },
    { maxWait: 10000, timeout: 30000 }
  );

  return loadSequence(sequence.id);
}

export async function accelerateFollowUpSequenceForE2E(
  actor: AuthenticatedUser,
  sequenceId: string,
  options?: { env?: NodeJS.ProcessEnv; now?: Date }
): Promise<FollowUpSequenceDto> {
  const timing = getFollowUpTimingConfig(options?.env);
  if (timing.mode !== "e2e_accelerated_minutes") {
    throw new AppError(
      409,
      "CONFLICT",
      "E2E follow-up acceleration is not enabled for this environment"
    );
  }

  const now = options?.now ?? new Date();
  const sequence = await prisma.followUpSequence.findUnique({
    where: { id: sequenceId },
    include: { attempts: { orderBy: { stepIndex: "asc" } } }
  });
  if (!sequence) throw new AppError(404, "NOT_FOUND", "Follow-up sequence not found");
  if (sequence.status !== "ACTIVE") {
    throw new AppError(409, "CONFLICT", "Only active follow-up sequences can be accelerated");
  }

  const scheduledAttempts = sequence.attempts.filter((attempt) => attempt.status === "SCHEDULED");
  if (scheduledAttempts.length === 0) {
    return toSequenceDto(sequence);
  }

  const eventIds = scheduledAttempts.map((attempt) => attempt.domainEventId).filter(Boolean) as string[];
  if (eventIds.length !== scheduledAttempts.length) {
    throw new AppError(
      409,
      "CONFLICT",
      "Cannot accelerate attempts without persisted domain events"
    );
  }

  const events = await prisma.domainEventOutbox.findMany({
    where: { id: { in: eventIds } },
    select: { id: true, status: true }
  });
  const eventStatusById = new Map(events.map((event) => [event.id, event.status]));
  const unsafeAttempt = scheduledAttempts.find(
    (attempt) => eventStatusById.get(attempt.domainEventId ?? "") !== "PENDING"
  );
  if (unsafeAttempt) {
    throw new AppError(
      409,
      "CONFLICT",
      "Cannot accelerate attempts after their domain events have already been queued"
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.followUpSequence.update({
      where: { id: sequence.id },
      data: {
        cadenceMode: FOLLOW_UP_CADENCE_MODES[timing.mode],
        cadenceOffsetsMinutes: timing.offsetsMinutes
      }
    });

    for (const attempt of scheduledAttempts) {
      const scheduledAt = scheduleAt(
        now,
        timing.offsetsMinutes[attempt.stepIndex] ?? timing.offsetsMinutes.at(-1) ?? 0
      );
      await tx.followUpAttempt.update({
        where: { id: attempt.id },
        data: { scheduledAt }
      });
      await tx.domainEventOutbox.update({
        where: { id: attempt.domainEventId ?? "" },
        data: { nextAttemptAt: scheduledAt }
      });
    }

    await tx.auditEvent.create({
      data: {
        actorType: "USER",
        actorId: actor.id,
        entityType: "FollowUpSequence",
        entityId: sequence.id,
        action: "FOLLOW_UP_SEQUENCE_E2E_ACCELERATED",
        after: {
          leadId: sequence.leadId,
          untouchedSentAttempts: sequence.attempts.filter((attempt) => attempt.status === "SENT")
            .length,
          rescheduledAttemptIds: scheduledAttempts.map((attempt) => attempt.id),
          cadenceMode: FOLLOW_UP_CADENCE_MODES[timing.mode],
          cadenceOffsetsMinutes: timing.offsetsMinutes
        }
      }
    });
  });

  return loadSequence(sequence.id);
}

export async function stopActiveFollowUpsForLead(input: {
  leadId: string;
  reason: string;
}): Promise<number> {
  const now = new Date();
  const sequences = await prisma.followUpSequence.findMany({
    where: { leadId: input.leadId, status: "ACTIVE" },
    include: { attempts: { where: { status: "SCHEDULED" } } }
  });
  for (const sequence of sequences) {
    await prisma.$transaction(async (tx) => {
      await tx.followUpSequence.update({
        where: { id: sequence.id },
        data: { status: "STOPPED", stopReason: input.reason, stoppedAt: now }
      });
      await tx.followUpAttempt.updateMany({
        where: { sequenceId: sequence.id, status: "SCHEDULED" },
        data: { status: "CANCELLED", failedAt: now, failureCode: input.reason }
      });
      await tx.domainEventOutbox.updateMany({
        where: {
          id: { in: sequence.attempts.map((attempt) => attempt.domainEventId).filter(Boolean) as string[] },
          status: { in: ["PENDING", "QUEUED"] }
        },
        data: {
          status: "ATTENTION_REQUIRED",
          deadLetteredAt: now,
          lastErrorCode: input.reason,
          lastErrorMessage: "Follow-up automation stopped before execution"
        }
      });
      await tx.auditEvent.create({
        data: {
          actorType: "SYSTEM",
          entityType: "FollowUpSequence",
          entityId: sequence.id,
          action: "FOLLOW_UP_SEQUENCE_STOPPED",
          after: { leadId: input.leadId, reason: input.reason }
        }
      });
    });
  }
  return sequences.length;
}
