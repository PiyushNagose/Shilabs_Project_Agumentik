import { AgentType, LeadPreferredChannel, Prisma } from "@prisma/client";
import type {
  FollowUpAttemptDto,
  FollowUpPolicyCriteriaDto,
  FollowUpSequenceDto
} from "@shilabs/shared-types";
import { getFollowUpTimingConfig } from "@shilabs/shared-config";
import { AppError } from "../../shared/errors.js";
import { prisma } from "../../shared/prisma.js";
import type { AuthenticatedUser } from "../auth/auth.types.js";
import { assertAgentCapabilityActive } from "../agents/agent.service.js";
import { createAIProvider } from "../ai/ai.factory.js";
import type { AIProvider } from "../ai/ai.provider.js";
import { listApprovedKnowledge } from "../knowledge-base/knowledge-base.service.js";
import { publishDomainEvent } from "../domain-events/domain-events.service.js";
import { validateOutboundEmailPreSend } from "../email/email.service.js";
import { assertCanAccessLead, assertCanMutateLead } from "../leads/lead.permissions.js";
import type { StartFollowUpSequenceInput } from "./followup.schemas.js";
import { getFollowUpDays } from "./followup-timing.js";
import {
  followUpPolicyCriteria,
  selectFollowUpPolicy,
  resolveFollowUpCommunicationPersonality
} from "./followup-policy.service.js";

const FOLLOW_UP_CADENCE_MODES = {
  production_days: "PRODUCTION_DAYS",
  e2e_accelerated_minutes: "E2E_ACCELERATED_MINUTES"
} as const;

type SequenceRecord = Prisma.FollowUpSequenceGetPayload<{ include: { attempts: true } }>;
type FollowUpLeadActionAttempt = Pick<
  SequenceRecord["attempts"][number],
  "stepIndex" | "scheduledAt"
>;

interface StartOptions {
  provider?: AIProvider;
  env?: NodeJS.ProcessEnv;
  now?: Date;
}

function policyCriteriaJson(
  policy: Awaited<ReturnType<typeof selectFollowUpPolicy>>
): Prisma.InputJsonObject {
  return followUpPolicyCriteria(policy) as unknown as Prisma.InputJsonObject;
}

export function assertSafeFollowUpDraft(body: string, contactName: string): void {
  const normalizedBody = body.toLocaleLowerCase();
  const normalizedContact = contactName.trim().toLocaleLowerCase();
  const signOffPosition = Math.max(
    normalizedBody.lastIndexOf("best regards"),
    normalizedBody.lastIndexOf("regards"),
    normalizedBody.lastIndexOf("sincerely")
  );
  const signatureArea =
    signOffPosition >= 0 ? normalizedBody.slice(signOffPosition) : normalizedBody.slice(-120);
  if (!body.trim() || (normalizedContact.length > 2 && signatureArea.includes(normalizedContact))) {
    throw new AppError(
      422,
      "PROVIDER_ERROR",
      "AI follow-up draft appeared to impersonate the customer"
    );
  }
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
  const reviewAttempt =
    sequence.status === "ATTENTION_REQUIRED"
      ? sequence.attempts.find(
          (attempt) =>
            attempt.status === "BLOCKED" && attempt.failureCode === "FOLLOW_UP_REQUIRES_REVIEW" && attempt.textBody.trim()
        )
      : undefined;
  return {
    id: sequence.id,
    leadId: sequence.leadId,
    contactId: sequence.contactId,
    conversationId: sequence.conversationId,
    status: sequence.status,
    cadenceDays: sequence.cadenceDays,
    cadenceMode: sequence.cadenceMode,
    cadenceOffsetsMinutes: sequence.cadenceOffsetsMinutes,
    policyId: sequence.policyId,
    policyName: sequence.policyName,
    policyCriteria: sequence.policyCriteria as FollowUpPolicyCriteriaDto | null,
    e2eAccelerationEligible,
    currentStep: sequence.currentStep,
    stopReason: sequence.stopReason,
    stoppedAt: sequence.stoppedAt?.toISOString() ?? null,
    completedAt: sequence.completedAt?.toISOString() ?? null,
    lastErrorCode: sequence.lastErrorCode,
    lastErrorMessage: sequence.lastErrorMessage,
    idempotencyKey: sequence.idempotencyKey,
    attempts: sequence.attempts.sort((a, b) => a.stepIndex - b.stepIndex).map(toAttemptDto),
    reviewDraft: reviewAttempt
      ? {
          attemptId: reviewAttempt.id,
          subject: reviewAttempt.subject,
          body: reviewAttempt.textBody,
          reason: reviewAttempt.failureMessage ?? "Review this message before sending."
        }
      : null,
    createdAt: sequence.createdAt.toISOString(),
    updatedAt: sequence.updatedAt.toISOString()
  };
}

function followUpLeadNextAction(attempt: FollowUpLeadActionAttempt): {
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

async function isE2EAccelerationEligible(sequence: SequenceRecord): Promise<boolean> {
  if (sequence.status !== "ACTIVE" || sequence.cadenceMode === "E2E_ACCELERATED_MINUTES") {
    return false;
  }

  const scheduledAttempts = sequence.attempts.filter((attempt) => attempt.status === "SCHEDULED");
  if (scheduledAttempts.length === 0) {
    return false;
  }

  const eventIds = scheduledAttempts
    .map((attempt) => attempt.domainEventId)
    .filter(Boolean) as string[];
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
  actor: AuthenticatedUser,
  leadId: string
): Promise<FollowUpSequenceDto[]> {
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: { id: true, ownerId: true, workspaceId: true }
  });
  if (!lead) throw new AppError(404, "NOT_FOUND", "Lead not found");
  assertCanAccessLead(actor, lead);
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
  workspaceId: string | null;
  leadId: string;
  contactId: string;
  conversationId: string | null;
  idempotencyKey: string;
  code: string;
  message: string;
  policy: Awaited<ReturnType<typeof selectFollowUpPolicy>>;
  cadenceDays: number[];
  reviewDraft?: { body: string; reason: string; stepIndex: number; subject: string };
}): Promise<FollowUpSequenceDto> {
  const sequence = await prisma.followUpSequence.upsert({
    where: { idempotencyKey: input.idempotencyKey },
    create: {
      workspaceId: input.workspaceId,
      leadId: input.leadId,
      contactId: input.contactId,
      conversationId: input.conversationId,
      status: "ATTENTION_REQUIRED",
      cadenceDays: input.cadenceDays,
      cadenceMode: FOLLOW_UP_CADENCE_MODES.production_days,
      cadenceOffsetsMinutes: input.cadenceDays.map((day) => day * 24 * 60),
      policyId: input.policy.id,
      policyName: input.policy.name,
      policyCriteria: policyCriteriaJson(input.policy),
      idempotencyKey: input.idempotencyKey,
      lastErrorCode: input.code,
      lastErrorMessage: input.message,
      ...(input.reviewDraft
        ? {
            attempts: {
              create: {
                leadId: input.leadId,
                stepIndex: input.reviewDraft.stepIndex,
                kind: input.reviewDraft.stepIndex === 0 ? "FIRST_EMAIL" : "FOLLOW_UP",
                status: "BLOCKED",
                scheduledAt: new Date(),
                subject: input.reviewDraft.subject,
                textBody: input.reviewDraft.body,
                failureCode: "FOLLOW_UP_REQUIRES_REVIEW",
                failureMessage: input.reviewDraft.reason,
                idempotencyKey: `review:${input.idempotencyKey}`
              }
            }
          }
        : {})
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
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    include: {
      company: true,
      contact: true,
      qualification: true,
      intelligence: true,
      intelligenceDocuments: {
        where: { status: "INDEXED" },
        include: { chunks: { orderBy: { position: "asc" }, take: 20 } },
        orderBy: { indexedAt: "desc" },
        take: 10
      },
      conversations: { where: { channel: "EMAIL" }, orderBy: { createdAt: "desc" }, take: 1 }
    }
  });
  if (!lead) throw new AppError(404, "NOT_FOUND", "Lead not found");
  assertCanMutateLead(actor, lead);
  if (!lead.workspaceId) {
    throw new AppError(409, "CONFLICT", "Lead has no persisted workspace");
  }
  const existing = await prisma.followUpSequence.findUnique({
    where: { idempotencyKey },
    include: { attempts: true }
  });
  if (existing) {
    if (existing.leadId !== lead.id || existing.workspaceId !== lead.workspaceId) {
      throw new AppError(409, "CONFLICT", "Idempotency key is already in use");
    }
    return loadSequence(existing.id);
  }
  if (lead.workspaceId) await assertAgentCapabilityActive(lead.workspaceId, AgentType.OUTREACH);

  const policy = await selectFollowUpPolicy(lead.workspaceId, {
    companyId: lead.companyId,
    service: lead.serviceInterest,
    leadType: lead.leadType,
    source: lead.source,
    country: lead.country ?? lead.company.location,
    priority: lead.priority ?? lead.temperature,
    managerId: lead.ownerId,
    campaign: lead.campaign,
    pipelineStageId: lead.stageId
  });
  const timing = getFollowUpTimingConfig(options?.env);
  const cadenceDays =
    timing.mode === "e2e_accelerated_minutes"
      ? timing.e2eBaselineCadenceDays
      : getFollowUpDays(
          policy.cadenceDays,
          lead.intelligence?.followUpMode,
          lead.intelligence?.customCadenceDays
        );
  const cadenceOffsetsMinutes =
    timing.mode === "e2e_accelerated_minutes"
      ? timing.offsetsMinutes
      : cadenceDays.map((day) => day * 24 * 60);

  const preferredChannel = lead.intelligence?.preferredChannel ??
    Object.values(LeadPreferredChannel).find((channel) => channel === lead.contact.preferredChannel) ?? "EMAIL";
  const eligibility = ["PHONE", "WHATSAPP"].includes(preferredChannel)
    ? {
        allowed:
          !lead.contact.doNotContact &&
          !["WON", "LOST", "DISQUALIFIED"].includes(lead.status) &&
          !["OFF", "PAUSED"].includes(lead.intelligence?.aiControlStatus ?? "") &&
          !lead.intelligence?.humanInterventionRequired,
        code: "LEAD_CONTROLS_BLOCK_OUTREACH",
        message: "This lead is not available for automatic follow-up."
      }
    : await validateOutboundEmailPreSend(actor, { leadId });
  if (!eligibility.allowed) {
    return createAttentionSequence({
      workspaceId: lead.workspaceId,
      leadId,
      contactId: lead.contactId,
      conversationId: lead.conversations[0]?.id ?? null,
      idempotencyKey,
      code: eligibility.code ?? "FOLLOW_UP_BLOCKED",
      message: eligibility.message ?? "Follow-up automation is blocked",
      policy,
      cadenceDays
    });
  }
  if (lead.automationOwnershipState !== "AI_ACTIVE") {
    throw new AppError(
      409,
      "CONFLICT",
      `Follow-up automation requires AI_ACTIVE ownership; current state is ${lead.automationOwnershipState}`
    );
  }
  const conversation = lead.conversations[0];
  if (conversation && ["HUMAN", "PAUSED", "CLOSED"].includes(conversation.mode)) {
    return createAttentionSequence({
      workspaceId: lead.workspaceId,
      leadId,
      contactId: lead.contactId,
      conversationId: conversation.id,
      idempotencyKey,
      code: "CONVERSATION_NOT_AUTOMATED",
      message: `Conversation mode ${conversation.mode} blocks follow-up automation`,
      policy,
      cadenceDays
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
      workspaceId: lead.workspaceId,
      leadId,
      contactId: lead.contactId,
      conversationId: conversation?.id ?? null,
      idempotencyKey,
      code: "HUMAN_TAKEOVER_ACTIVE",
      message: "Human takeover blocks follow-up automation",
      policy,
      cadenceDays
    });
  }

  const activeSequence = await prisma.followUpSequence.findFirst({
    where: { leadId, status: "ACTIVE" },
    orderBy: { createdAt: "desc" },
    select: { id: true }
  });
  if (activeSequence) return loadSequence(activeSequence.id);

  const approvedKnowledge = await listApprovedKnowledge(lead.workspaceId, { limit: 20 });
  const messages = conversation
    ? await prisma.message.findMany({
        where: { conversationId: conversation.id },
        select: { id: true, senderType: true, body: true },
        orderBy: { createdAt: "asc" },
        take: 50
      })
    : [];
  const now = options?.now ?? new Date();
  const automaticAction =
    lead.nextAction === "Send first follow-up email" ||
    lead.nextAction?.startsWith("Send follow-up email ") === true ||
    lead.nextAction?.startsWith("Automatic follow-up ") === true;
  const promisedDelay =
    timing.mode === "production_days" && !automaticAction && lead.nextActionAt
      ? Math.max(
          0,
          lead.nextActionAt.getTime() - scheduleAt(now, cadenceOffsetsMinutes[0] ?? 0).getTime()
        )
      : 0;
  const drafts: string[] = [];
  let draftRequiresReview = false;
  let reviewDraft: { body: string; reason: string; stepIndex: number; subject: string } | undefined;
  const communicationPersonality = await resolveFollowUpCommunicationPersonality(lead.workspaceId, {
    companyId: lead.companyId,
    service: lead.serviceInterest,
    leadType: lead.leadType,
    source: lead.source,
    country: lead.country ?? lead.company.location,
    priority: lead.priority ?? lead.temperature,
    managerId: lead.ownerId,
    campaign: lead.campaign,
    pipelineStageId: lead.stageId
  });
  try {
    const provider = options?.provider ?? createAIProvider(options?.env);
    for (const [index, day] of cadenceDays.entries()) {
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
          cadenceOffsetMinutes: cadenceOffsetsMinutes[index],
          leadId: lead.id,
          communicationPersonality,
          company: lead.company.name,
          contact: `${lead.contact.firstName} ${lead.contact.lastName}`.trim(),
          requirement: lead.requirement,
          serviceInterest: lead.serviceInterest,
          qualification: lead.qualification,
          intelligence: lead.intelligence
            ? {
                communicationStyle: lead.intelligence.communicationStyle,
                objections: lead.intelligence.objections,
                commitments: lead.intelligence.commitments,
                nextObjective: lead.intelligence.nextObjective,
                preferredChannel: lead.intelligence.preferredChannel
              }
            : null,
          approvedLeadDocuments: lead.intelligenceDocuments.map((document) => ({
            id: document.id,
            title: document.title,
            kind: document.kind,
            evidence: document.chunks.map((chunk) => chunk.content)
          }))
        })
      });
      assertSafeFollowUpDraft(
        output.body,
        `${lead.contact.firstName} ${lead.contact.lastName}`.trim()
      );
      if (output.requiresHumanReview) {
        draftRequiresReview = true;
        reviewDraft = {
          body: output.body,
          reason: output.reason?.trim() ?? "This follow-up needs a salesperson's approval.",
          stepIndex: index,
          subject: subjectFor({
            stepIndex: index,
            serviceInterest: lead.serviceInterest,
            requirement: lead.requirement
          })
        };
        throw new AppError(422, "PROVIDER_ERROR", "A salesperson must review this follow-up.");
      }
      drafts.push(output.body);
    }
  } catch (error) {
    return createAttentionSequence({
      workspaceId: lead.workspaceId,
      leadId,
      contactId: lead.contactId,
      conversationId: conversation?.id ?? null,
      idempotencyKey,
      code: draftRequiresReview ? "AI_FOLLOW_UP_REQUIRES_REVIEW" : "AI_FOLLOW_UP_DRAFT_FAILED",
      message:
        reviewDraft?.reason ??
        (error instanceof Error ? error.message : "AI follow-up draft generation failed"),
      reviewDraft,
      policy,
      cadenceDays
    });
  }

  const sequence = await prisma.$transaction(
    async (tx) => {
      const emailConversation =
        conversation ??
        (await tx.conversation.create({
          data: {
            workspaceId: lead.workspaceId,
            leadId,
            channel: "EMAIL",
            mode: "AUTO",
            status: "OPEN"
          }
        }));
      await tx.followUpSequence.updateMany({
        where: {
          workspaceId: lead.workspaceId,
          leadId,
          status: "ATTENTION_REQUIRED",
          OR: [
            { lastErrorCode: "AI_FOLLOW_UP_REQUIRES_REVIEW" },
            { lastErrorMessage: "A salesperson must review this follow-up." }
          ]
        },
        data: { status: "STOPPED", stopReason: "DRAFT_REPLACED", stoppedAt: now }
      });
      const created = await tx.followUpSequence.create({
        data: {
          workspaceId: lead.workspaceId,
          leadId,
          contactId: lead.contactId,
          conversationId: emailConversation.id,
          cadenceDays,
          cadenceMode: FOLLOW_UP_CADENCE_MODES[timing.mode],
          cadenceOffsetsMinutes,
          policyId: policy.id,
          policyName: policy.name,
          policyCriteria: policyCriteriaJson(policy),
          idempotencyKey,
          createdAt: now
        }
      });
      let firstScheduledAttempt: FollowUpLeadActionAttempt | null = null;

      for (const [index, day] of cadenceDays.entries()) {
        const scheduledAt = new Date(
          scheduleAt(now, cadenceOffsetsMinutes[index] ?? day * 24 * 60).getTime() + promisedDelay
        );
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
        firstScheduledAttempt ??= attempt;
      }

      if (firstScheduledAttempt) {
        await tx.lead.update({
          where: { id: leadId },
          data: followUpLeadNextAction(firstScheduledAttempt)
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
            cadenceDays,
            cadenceMode: FOLLOW_UP_CADENCE_MODES[timing.mode],
            cadenceOffsetsMinutes,
            policyId: policy.id,
            policyName: policy.name,
            policyCriteria: policyCriteriaJson(policy)
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

  const eventIds = scheduledAttempts
    .map((attempt) => attempt.domainEventId)
    .filter(Boolean) as string[];
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

    const nextAttempt = scheduledAttempts
      .map((attempt) => ({
        stepIndex: attempt.stepIndex,
        scheduledAt: scheduleAt(
          now,
          timing.offsetsMinutes[attempt.stepIndex] ?? timing.offsetsMinutes.at(-1) ?? 0
        )
      }))
      .sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime())[0];
    if (nextAttempt) {
      await tx.lead.update({
        where: { id: sequence.leadId },
        data: followUpLeadNextAction(nextAttempt)
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

export async function runCallingAttemptNowForE2E(
  actor: AuthenticatedUser,
  leadId: string,
  options?: { env?: NodeJS.ProcessEnv; now?: Date }
): Promise<{ status: "ACCELERATED" | "ALREADY_QUEUED"; attemptId: string; scheduledAt: string }> {
  if (getFollowUpTimingConfig(options?.env).mode !== "e2e_accelerated_minutes") {
    throw new AppError(
      409,
      "CONFLICT",
      "E2E calling acceleration is not enabled in this environment"
    );
  }
  const lead = await prisma.lead.findUnique({ where: { id: leadId } });
  if (!lead) throw new AppError(404, "NOT_FOUND", "Lead not found");
  assertCanMutateLead(actor, lead);
  if (!lead.workspaceId) {
    throw new AppError(409, "CONFLICT", "Lead has no persisted workspace");
  }

  const sequences = await prisma.callingSequence.findMany({
    where: { leadId, status: { in: ["ACTIVE", "ATTENTION_REQUIRED"] } },
    include: { attempts: { orderBy: { attemptIndex: "asc" } } },
    orderBy: { createdAt: "desc" }
  });
  const sequence = sequences.find((candidate) =>
    candidate.attempts.some((item) => item.status === "SCHEDULED")
  );
  const attempt = sequence?.attempts.find((item) => item.status === "SCHEDULED");
  const exhausted = sequences.find(
    (candidate) =>
      candidate.attempts.length > 0 &&
      candidate.attempts.every((item) => item.status !== "SCHEDULED")
  );

  if (!attempt) {
    const scheduledAt = options?.now ?? new Date();
    const retryKey = exhausted
      ? `calling-sequence:e2e-retry:${exhausted.id}`
      : `calling-sequence:e2e:${lead.id}`;
    const retry = await prisma.$transaction(async (tx) => {
      const createdSequence = await tx.callingSequence.upsert({
        where: { idempotencyKey: retryKey },
        create: {
          workspaceId: lead.workspaceId,
          leadId,
          contactId: exhausted?.contactId ?? lead.contactId,
          followUpSequenceId: exhausted?.followUpSequenceId,
          cadenceOffsets: [0],
          maxAttempts: 1,
          idempotencyKey: retryKey
        },
        update: { status: "ACTIVE", stopReason: null, stoppedAt: null, completedAt: null }
      });
      const createdAttempt = await tx.callingAttempt.upsert({
        where: { idempotencyKey: `calling-attempt:${createdSequence.id}:0` },
        create: {
          sequenceId: createdSequence.id,
          leadId,
          contactId: exhausted?.contactId ?? lead.contactId,
          attemptIndex: 0,
          scheduledAt,
          idempotencyKey: `calling-attempt:${createdSequence.id}:0`
        },
        update: { status: "SCHEDULED", scheduledAt, failureCode: null, failureMessage: null }
      });
      const event = await tx.domainEventOutbox.upsert({
        where: { idempotencyKey: `domain-event:calling-attempt:${createdAttempt.id}` },
        create: {
          workspaceId: lead.workspaceId,
          eventType: "CALL_AUTOMATION_ATTEMPT_DUE",
          aggregateType: "CallingAttempt",
          aggregateId: createdAttempt.id,
          payload: {
            leadId,
            contactId: exhausted?.contactId ?? lead.contactId,
            callingSequenceId: createdSequence.id,
            callingAttemptId: createdAttempt.id
          },
          correlationId: createdSequence.id,
          idempotencyKey: `domain-event:calling-attempt:${createdAttempt.id}`,
          nextAttemptAt: scheduledAt,
          maxAttempts: 5
        },
        update: {
          nextAttemptAt: scheduledAt,
          status: "PENDING",
          lastErrorCode: null,
          lastErrorMessage: null
        }
      });
      await tx.callingAttempt.update({
        where: { id: createdAttempt.id },
        data: { domainEventId: event.id }
      });
      await tx.domainEventOutbox.upsert({
        where: { idempotencyKey: `domain-event:whatsapp-send:${createdAttempt.id}` },
        create: {
          workspaceId: lead.workspaceId,
          eventType: "WHATSAPP_SEND_REQUESTED",
          aggregateType: "CallingAttempt",
          aggregateId: createdAttempt.id,
          payload: {
            leadId,
            contactId: exhausted?.contactId ?? lead.contactId,
            callingSequenceId: createdSequence.id,
            callingAttemptId: createdAttempt.id
          },
          correlationId: createdSequence.id,
          idempotencyKey: `domain-event:whatsapp-send:${createdAttempt.id}`,
          nextAttemptAt: scheduledAt,
          maxAttempts: 5
        },
        update: {}
      });
      await tx.lead.update({
        where: { id: leadId },
        data: { nextAction: "Call lead now", nextActionAt: scheduledAt }
      });
      return { id: createdAttempt.id, scheduledAt };
    });
    return {
      status: "ACCELERATED",
      attemptId: retry.id,
      scheduledAt: retry.scheduledAt.toISOString()
    };
  }

  if (!attempt.domainEventId || !sequence) {
    throw new AppError(409, "CONFLICT", "No active scheduled AI calling attempt is available");
  }
  const event = await prisma.domainEventOutbox.findUnique({
    where: { id: attempt.domainEventId },
    select: { status: true }
  });
  if (event?.status !== "PENDING") {
    if (event?.status === "QUEUED" || event?.status === "PROCESSING") {
      return {
        status: "ALREADY_QUEUED",
        attemptId: attempt.id,
        scheduledAt: attempt.scheduledAt.toISOString()
      };
    }
    throw new AppError(409, "CONFLICT", "Calling attempt is no longer pending");
  }

  const scheduledAt = options?.now ?? new Date();
  await prisma.$transaction(async (tx) => {
    await tx.callingAttempt.update({ where: { id: attempt.id }, data: { scheduledAt } });
    await tx.domainEventOutbox.update({
      where: { id: attempt.domainEventId ?? "" },
      data: { nextAttemptAt: scheduledAt }
    });
    await tx.lead.update({
      where: { id: leadId },
      data: { nextAction: "Call lead now", nextActionAt: scheduledAt }
    });
    await tx.auditEvent.create({
      data: {
        actorType: "USER",
        actorId: actor.id,
        entityType: "CallingAttempt",
        entityId: attempt.id,
        action: "CALLING_ATTEMPT_E2E_ACCELERATED",
        after: { leadId, scheduledAt: scheduledAt.toISOString() }
      }
    });
  });
  return { status: "ACCELERATED", attemptId: attempt.id, scheduledAt: scheduledAt.toISOString() };
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
          id: {
            in: sequence.attempts
              .map((attempt) => attempt.domainEventId)
              .filter(Boolean) as string[]
          },
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
