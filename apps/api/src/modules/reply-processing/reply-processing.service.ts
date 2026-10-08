import { AgentType, Prisma } from "@prisma/client";
import type { ReplyProcessingRunDto } from "@shilabs/shared-types";
import { getAIConfig } from "../../config/ai.js";
import { AppError } from "../../shared/errors.js";
import { prisma } from "../../shared/prisma.js";
import { createAIProvider } from "../ai/ai.factory.js";
import { assertAgentCapabilityActive } from "../agents/agent.service.js";
import type { AIProvider, ReplyUnderstandingResult } from "../ai/ai.provider.js";
import { replyUnderstandingResultSchema } from "../ai/ai.schemas.js";
import { sourceContainsGroundedQuote } from "../ai/grounding.js";
import { publishDomainEvent } from "../domain-events/domain-events.service.js";
import type { EmailProvider } from "../email/email.provider.js";
import { listApprovedKnowledge } from "../knowledge-base/knowledge-base.service.js";
import { createMeetingRequestForReply } from "../meetings/meeting.service.js";
import { createNegotiationHandoffForReply } from "../notifications/notification.service.js";
import { recalculateQualification } from "../qualification/qualification.service.js";
import { orchestrateSalesConversationForReply } from "../sales-conversation/sales-conversation-orchestrator.service.js";
import { recalculateLeadScoreForSystem } from "../scoring/scoring.service.js";
import {
  explicitNegotiationSignals,
  hasExplicitDncStopSignal,
  intentRequiresHumanReviewGate,
  safeReplyUnderstandingOutput
} from "./reply-policy.js";

export interface ProcessReplyOptions {
  provider?: AIProvider;
  emailProvider?: EmailProvider;
  env?: NodeJS.ProcessEnv;
}

type ReplyRunRecord = Prisma.ReplyProcessingRunGetPayload<Record<string, never>>;
type ReplyInboundRecord = Prisma.InboundEmailGetPayload<{
  include: {
    lead: { include: { company: true; contact: true } };
    conversation: true;
    message: true;
  };
}>;
type EligibleReplyInboundRecord = ReplyInboundRecord & {
  lead: NonNullable<ReplyInboundRecord["lead"]>;
  conversation: NonNullable<ReplyInboundRecord["conversation"]>;
  message: NonNullable<ReplyInboundRecord["message"]>;
};

const replyProcessingTransactionOptions = { timeout: 15000 };
function toDto(run: ReplyRunRecord): ReplyProcessingRunDto {
  return {
    id: run.id,
    leadId: run.leadId,
    conversationId: run.conversationId,
    messageId: run.messageId,
    inboundEmailId: run.inboundEmailId,
    status: run.status,
    intent: run.intent,
    recommendedAction: run.recommendedAction,
    confidence: run.confidence?.toString() ?? null,
    summary: run.summary,
    draftResponse: run.draftResponse,
    requiresHumanReview: run.requiresHumanReview,
    humanHandoffRequired: run.humanHandoffRequired,
    provider: run.provider,
    model: run.model,
    failureCode: run.failureCode,
    failureMessage: run.failureMessage,
    createdAt: run.createdAt.toISOString(),
    updatedAt: run.updatedAt.toISOString()
  };
}

function providerMetadata(
  env: NodeJS.ProcessEnv | undefined,
  provider?: AIProvider
): {
  providerName: string;
  model: string;
} {
  if (provider) return { providerName: "test-double", model: "test-double" };
  const config = getAIConfig(env);
  return {
    providerName: config.AI_PROVIDER,
    model: config.AI_PROVIDER === "gemini" ? config.GEMINI_MODEL : config.OPENAI_MODEL
  };
}

function validateGrounding(input: {
  output: ReplyUnderstandingResult;
  messages: { id: string; body: string }[];
  approvedKnowledgeIds: Set<string>;
}): void {
  for (const evidence of input.output.evidence) {
    const message = input.messages.find((item) => item.id === evidence.messageId);
    if (!sourceContainsGroundedQuote(message?.body, evidence.quote)) {
      throw new AppError(502, "PROVIDER_ERROR", "AI reply evidence was not grounded in messages");
    }
  }
  for (const id of input.output.usedKnowledgeIds) {
    if (!input.approvedKnowledgeIds.has(id)) {
      throw new AppError(502, "PROVIDER_ERROR", "AI referenced unapproved knowledge");
    }
  }
}

function deterministicNegotiationOutput(
  messages: { id: string; senderType: string; body: string }[]
): ReplyUnderstandingResult | null {
  const message = [...messages]
    .reverse()
    .find(
      (item) =>
        item.senderType === "PROSPECT" &&
        explicitNegotiationSignals.some((signal) => item.body.toLowerCase().includes(signal))
    );
  if (!message) return null;
  const matchedSignal =
    explicitNegotiationSignals.find((signal) => message.body.toLowerCase().includes(signal)) ??
    "negotiation";
  const quoteStart = message.body.toLowerCase().indexOf(matchedSignal);
  const quote =
    quoteStart >= 0
      ? message.body.slice(quoteStart, quoteStart + matchedSignal.length)
      : matchedSignal;
  return {
    intent: "NEGOTIATION",
    confidence: 0.7,
    summary: "Prospect explicitly requested negotiation or improved commercial terms.",
    draftResponse: null,
    requiresHumanReview: true,
    recommendedAction: "HUMAN_HANDOFF",
    evidence: [{ messageId: message.id, quote }],
    usedKnowledgeIds: []
  };
}

export async function processInboundReply(
  inboundEmailId: string,
  options?: ProcessReplyOptions
): Promise<ReplyProcessingRunDto> {
  const idempotencyKey = `reply-processing:inbound:${inboundEmailId}`;
  const existing = await prisma.replyProcessingRun.findUnique({ where: { idempotencyKey } });
  if (existing?.status === "COMPLETED") {
    const completed =
      intentRequiresHumanReviewGate(existing.intent) && !existing.humanHandoffRequired
        ? await prisma.replyProcessingRun.update({
            where: { id: existing.id },
            data: { humanHandoffRequired: true, requiresHumanReview: true }
          })
        : existing;
    const existingInbound = await findEligibleInbound(inboundEmailId);
    if (existingInbound) {
      await createMeetingRequestForMeetingIntent({
        run: completed,
        inbound: existingInbound,
        intent: completed.intent,
        summary: completed.summary
      });
      await orchestrateSalesConversationForReply(completed.id, {
        aiProvider: options?.provider,
        emailProvider: options?.emailProvider,
        env: options?.env
      });
    }
    return toDto(completed);
  }

  const inbound = await findEligibleInbound(inboundEmailId);
  if (!inbound) {
    throw new AppError(409, "CONFLICT", "Inbound email is not eligible for reply processing");
  }
  const eligibleInbound: EligibleReplyInboundRecord = inbound;
  if (eligibleInbound.lead.workspaceId)
    await assertAgentCapabilityActive(
      eligibleInbound.lead.workspaceId,
      AgentType.REPLY_UNDERSTANDING
    );

  const messages = await prisma.message.findMany({
    where: { conversationId: eligibleInbound.conversationId ?? "" },
    select: { id: true, senderType: true, body: true, createdAt: true },
    orderBy: { createdAt: "asc" },
    take: 80
  });
  const qualification = await prisma.leadQualification.findUnique({
    where: { leadId: eligibleInbound.leadId ?? "" },
    include: { evidence: true }
  });
  const approvedKnowledge = await listApprovedKnowledge({ limit: 20 });
  const approvedKnowledgeIds = new Set(approvedKnowledge.map((item) => item.versionId));
  const inputContext = {
    inboundEmailId: eligibleInbound.id,
    lead: {
      id: eligibleInbound.lead.id,
      status: eligibleInbound.lead.status,
      source: eligibleInbound.lead.source,
      requirement: eligibleInbound.lead.requirement,
      serviceInterest: eligibleInbound.lead.serviceInterest,
      company: eligibleInbound.lead.company.name,
      contact:
        `${eligibleInbound.lead.contact.firstName} ${eligibleInbound.lead.contact.lastName}`.trim(),
      doNotContact: eligibleInbound.lead.contact.doNotContact
    },
    qualification,
    approvedKnowledgeIds: approvedKnowledge.map((item) => item.versionId),
    messageIds: messages.map((message) => message.id)
  } satisfies Prisma.InputJsonObject;

  let metadata: { providerName: string; model: string };
  try {
    metadata = providerMetadata(options?.env, options?.provider);
  } catch (error) {
    const run = await createFailedRun({
      inbound: eligibleInbound,
      idempotencyKey,
      inputContext,
      code: "AI_NOT_CONFIGURED",
      message: error instanceof Error ? error.message : "AI provider is not configured"
    });
    return toDto(run);
  }

  try {
    const provider = options?.provider ?? createAIProvider(options?.env);
    const rawOutput = await provider.understandReply({
      messages: messages.map((message) => ({
        id: message.id,
        senderType: message.senderType,
        body: message.body
      })),
      leadContext: JSON.stringify(inputContext),
      approvedKnowledge: approvedKnowledge.map((item) => ({
        id: item.versionId,
        content: item.content
      }))
    });
    const parsed = replyUnderstandingResultSchema.parse(rawOutput);
    validateGrounding({
      output: parsed,
      messages,
      approvedKnowledgeIds
    });
    const output = safeReplyUnderstandingOutput(parsed, messages);
    await recalculateQualification(eligibleInbound.lead.id, provider);
    await recalculateLeadScoreForSystem(eligibleInbound.lead.id);
    const run = await persistSuccessfulRun({
      inbound: eligibleInbound,
      idempotencyKey,
      inputContext,
      output,
      metadata
    });
    await createMeetingRequestForMeetingIntent({
      run,
      inbound: eligibleInbound,
      intent: output.intent,
      summary: output.summary
    });
    await orchestrateSalesConversationForReply(run.id, {
      aiProvider: provider,
      emailProvider: options?.emailProvider,
      env: options?.env
    });
    return toDto(run);
  } catch (error) {
    const code = error instanceof AppError ? error.code : "PROVIDER_ERROR";
    const message = error instanceof Error ? error.message : "Reply processing failed";
    const fallbackOutput =
      code === "RETRYABLE_PROVIDER_ERROR" ? deterministicNegotiationOutput(messages) : null;
    if (fallbackOutput) {
      const run = await persistSuccessfulRun({
        inbound: eligibleInbound,
        idempotencyKey,
        inputContext,
        output: safeReplyUnderstandingOutput(fallbackOutput, messages),
        metadata: {
          providerName: "deterministic-negotiation-safety",
          model: "explicit-commercial-terms-v1"
        }
      });
      await createMeetingRequestForMeetingIntent({
        run,
        inbound: eligibleInbound,
        intent: fallbackOutput.intent,
        summary: fallbackOutput.summary
      });
      await orchestrateSalesConversationForReply(run.id, {
        aiProvider: options?.provider,
        emailProvider: options?.emailProvider,
        env: options?.env
      });
      return toDto(run);
    }
    const run = await createFailedRun({
      inbound: eligibleInbound,
      idempotencyKey,
      inputContext,
      code,
      message,
      metadata
    });
    return toDto(run);
  }
}

function messageProvider(
  message: Prisma.MessageGetPayload<Record<string, never>>
): "TWILIO" | "META_WHATSAPP" {
  const metadata = message.metadata;
  if (
    typeof metadata === "object" &&
    metadata !== null &&
    !Array.isArray(metadata) &&
    metadata.provider === "TWILIO_WHATSAPP"
  ) {
    return "TWILIO";
  }
  return "META_WHATSAPP";
}

export async function processInboundMessageReply(
  messageId: string,
  options?: ProcessReplyOptions
): Promise<ReplyProcessingRunDto> {
  const message = await prisma.message.findUnique({
    where: { id: messageId },
    include: {
      conversation: {
        include: {
          lead: { include: { company: true, contact: true } }
        }
      }
    }
  });
  if (
    message?.direction !== "INBOUND" ||
    message.senderType !== "PROSPECT" ||
    message.conversation.channel !== "WHATSAPP"
  ) {
    throw new AppError(409, "CONFLICT", "Inbound message is not eligible for reply processing");
  }
  const lead = message.conversation.lead;
  if (lead.workspaceId)
    await assertAgentCapabilityActive(lead.workspaceId, AgentType.REPLY_UNDERSTANDING);
  const provider = messageProvider(message);
  const providerMessageId = message.providerMessageId ?? message.id;
  const inbound = await prisma.inboundEmail.upsert({
    where: { messageId: message.id },
    create: {
      provider,
      providerMessageId,
      providerEventId: `whatsapp-message:${provider}:${providerMessageId}`,
      leadId: lead.id,
      contactId: lead.contactId,
      conversationId: message.conversationId,
      messageId: message.id,
      fromEmail: `whatsapp:${providerMessageId}@local.invalid`,
      normalizedFromEmail: `whatsapp:${providerMessageId}@local.invalid`,
      toEmails: ["whatsapp@local.invalid"],
      subject: "WhatsApp inbound reply",
      textBody: message.body,
      rawProviderPayload: {
        provider,
        channel: "WHATSAPP",
        messageId: message.id,
        providerMessageId
      },
      status: "PROCESSED",
      replyProcessingStatus: "PENDING",
      receivedAt: message.deliveredAt ?? message.createdAt,
      processedAt: new Date()
    },
    update: {
      leadId: lead.id,
      contactId: lead.contactId,
      conversationId: message.conversationId,
      textBody: message.body,
      status: "PROCESSED",
      replyProcessingStatus: "PENDING",
      processedAt: new Date()
    }
  });
  return processInboundReply(inbound.id, options);
}

async function findEligibleInbound(
  inboundEmailId: string
): Promise<EligibleReplyInboundRecord | null> {
  const inbound = await prisma.inboundEmail.findUnique({
    where: { id: inboundEmailId },
    include: {
      lead: { include: { company: true, contact: true } },
      conversation: true,
      message: true
    }
  });
  if (!inbound?.lead || !inbound.conversation || !inbound.message) return null;
  return inbound as EligibleReplyInboundRecord;
}

async function createMeetingRequestForMeetingIntent(input: {
  run: ReplyRunRecord;
  inbound: EligibleReplyInboundRecord;
  intent: string | null;
  summary: string | null;
}): Promise<void> {
  if (input.intent !== "MEETING_REQUEST") return;
  try {
    await createMeetingRequestForReply({
      leadId: input.inbound.lead.id,
      conversationId: input.inbound.conversation.id,
      replyProcessingRunId: input.run.id,
      inboundEmailId: input.inbound.id,
      summary: input.summary
    });
  } catch (error) {
    await prisma.auditEvent.create({
      data: {
        actorType: "SYSTEM",
        entityType: "ReplyProcessingRun",
        entityId: input.run.id,
        action: "MEETING_REQUEST_CREATION_FAILED",
        after: {
          leadId: input.inbound.lead.id,
          inboundEmailId: input.inbound.id,
          code: error instanceof AppError ? error.code : "MEETING_REQUEST_FAILED",
          message: error instanceof Error ? error.message : "Meeting request creation failed"
        }
      }
    });
    await publishDomainEvent({
      eventType: "MEETING_REQUEST_CREATION_FAILED",
      aggregateType: "ReplyProcessingRun",
      aggregateId: input.run.id,
      correlationId: input.inbound.id,
      idempotencyKey: `domain-event:reply-processing:${input.inbound.id}:meeting-request-failed`,
      payload: {
        leadId: input.inbound.lead.id,
        inboundEmailId: input.inbound.id,
        conversationId: input.inbound.conversation.id,
        code: error instanceof AppError ? error.code : "MEETING_REQUEST_FAILED"
      }
    });
  }
}

async function stopLeadAutomationForCustomerIntent(input: {
  client: Prisma.TransactionClient;
  leadId: string;
  reason: string;
}): Promise<void> {
  const stoppedAt = new Date();
  const followUps = await input.client.followUpSequence.findMany({
    where: { leadId: input.leadId, status: "ACTIVE" },
    include: { attempts: { where: { status: "SCHEDULED" } } }
  });
  for (const sequence of followUps) {
    const eventIds = sequence.attempts
      .map((attempt) => attempt.domainEventId)
      .filter((id): id is string => Boolean(id));
    await input.client.followUpSequence.update({
      where: { id: sequence.id },
      data: { status: "STOPPED", stopReason: input.reason, stoppedAt }
    });
    await input.client.followUpAttempt.updateMany({
      where: { sequenceId: sequence.id, status: "SCHEDULED" },
      data: {
        status: "CANCELLED",
        failedAt: stoppedAt,
        failureCode: input.reason,
        failureMessage: "Customer intent stopped pending follow-up automation"
      }
    });
    await input.client.domainEventOutbox.updateMany({
      where: { id: { in: eventIds }, status: { in: ["PENDING", "QUEUED", "PROCESSING"] } },
      data: {
        status: "ATTENTION_REQUIRED",
        deadLetteredAt: stoppedAt,
        lastErrorCode: input.reason,
        lastErrorMessage: "Customer intent stopped pending follow-up automation"
      }
    });
    await input.client.auditEvent.create({
      data: {
        actorType: "SYSTEM",
        entityType: "FollowUpSequence",
        entityId: sequence.id,
        action: "FOLLOW_UP_SEQUENCE_STOPPED",
        after: { leadId: input.leadId, reason: input.reason }
      }
    });
  }

  const callingSequences = await input.client.callingSequence.findMany({
    where: { leadId: input.leadId, status: "ACTIVE" },
    include: { attempts: { where: { status: "SCHEDULED" } } }
  });
  for (const sequence of callingSequences) {
    const eventIds = sequence.attempts
      .map((attempt) => attempt.domainEventId)
      .filter((id): id is string => Boolean(id));
    await input.client.callingSequence.update({
      where: { id: sequence.id },
      data: { status: "STOPPED", stopReason: input.reason, stoppedAt }
    });
    await input.client.callingAttempt.updateMany({
      where: { sequenceId: sequence.id, status: "SCHEDULED" },
      data: {
        status: "SKIPPED",
        completedAt: stoppedAt,
        failureCode: input.reason,
        failureMessage: "Customer intent stopped pending calling automation"
      }
    });
    await input.client.domainEventOutbox.updateMany({
      where: {
        OR: [{ id: { in: eventIds } }, { correlationId: sequence.id }],
        status: { in: ["PENDING", "QUEUED", "PROCESSING"] }
      },
      data: {
        status: "ATTENTION_REQUIRED",
        deadLetteredAt: stoppedAt,
        lastErrorCode: input.reason,
        lastErrorMessage: "Customer intent stopped pending calling/WhatsApp automation"
      }
    });
    await input.client.auditEvent.create({
      data: {
        actorType: "SYSTEM",
        entityType: "CallingSequence",
        entityId: sequence.id,
        action: "CALLING_SEQUENCE_STOPPED",
        after: { leadId: input.leadId, reason: input.reason }
      }
    });
  }
}

async function createFailedRun(input: {
  inbound: EligibleReplyInboundRecord;
  idempotencyKey: string;
  inputContext: Prisma.InputJsonObject;
  code: string;
  message: string;
  metadata?: { providerName: string; model: string };
}): Promise<ReplyRunRecord> {
  return prisma.$transaction(async (tx) => {
    const run = await tx.replyProcessingRun.upsert({
      where: { idempotencyKey: input.idempotencyKey },
      create: {
        leadId: input.inbound.leadId ?? "",
        conversationId: input.inbound.conversationId ?? "",
        messageId: input.inbound.messageId ?? "",
        inboundEmailId: input.inbound.id,
        status: "FAILED",
        provider: input.metadata?.providerName,
        model: input.metadata?.model,
        inputContext: input.inputContext,
        failureCode: input.code,
        failureMessage: input.message,
        idempotencyKey: input.idempotencyKey
      },
      update: {
        status: "FAILED",
        intent: null,
        recommendedAction: null,
        confidence: null,
        summary: null,
        draftResponse: null,
        requiresHumanReview: true,
        humanHandoffRequired: false,
        provider: input.metadata?.providerName,
        model: input.metadata?.model,
        inputContext: input.inputContext,
        output: Prisma.JsonNull,
        failureCode: input.code,
        failureMessage: input.message
      }
    });
    await tx.inboundEmail.update({
      where: { id: input.inbound.id },
      data: { replyProcessingStatus: "FAILED" }
    });
    await tx.auditEvent.create({
      data: {
        actorType: "SYSTEM",
        entityType: "ReplyProcessingRun",
        entityId: run.id,
        action: "REPLY_PROCESSING_FAILED",
        after: { inboundEmailId: input.inbound.id, code: input.code }
      }
    });
    await publishDomainEvent({
      client: tx,
      eventType: "REPLY_PROCESSING_FAILED",
      aggregateType: "ReplyProcessingRun",
      aggregateId: run.id,
      correlationId: input.inbound.id,
      idempotencyKey: `domain-event:reply-processing:${input.inbound.id}:failed`,
      payload: {
        inboundEmailId: input.inbound.id,
        leadId: input.inbound.leadId,
        conversationId: input.inbound.conversationId,
        code: input.code
      }
    });
    return run;
  }, replyProcessingTransactionOptions);
}

async function persistSuccessfulRun(input: {
  inbound: EligibleReplyInboundRecord;
  idempotencyKey: string;
  inputContext: Prisma.InputJsonObject;
  output: ReplyUnderstandingResult;
  metadata: { providerName: string; model: string };
}): Promise<ReplyRunRecord> {
  return prisma.$transaction(async (tx) => {
    const conversationId = input.inbound.conversationId;
    if (!conversationId) {
      throw new AppError(409, "CONFLICT", "Inbound email is missing conversation context");
    }
    const humanHandoffRequired = intentRequiresHumanReviewGate(input.output.intent);
    const run = await tx.replyProcessingRun.upsert({
      where: { idempotencyKey: input.idempotencyKey },
      create: {
        leadId: input.inbound.leadId ?? "",
        conversationId: input.inbound.conversationId ?? "",
        messageId: input.inbound.messageId ?? "",
        inboundEmailId: input.inbound.id,
        status: "COMPLETED",
        intent: input.output.intent,
        recommendedAction: input.output.recommendedAction,
        confidence: new Prisma.Decimal(input.output.confidence.toFixed(2)),
        summary: input.output.summary,
        draftResponse: input.output.draftResponse,
        requiresHumanReview: true,
        humanHandoffRequired,
        provider: input.metadata.providerName,
        model: input.metadata.model,
        inputContext: input.inputContext,
        output: input.output,
        idempotencyKey: input.idempotencyKey
      },
      update: {
        status: "COMPLETED",
        intent: input.output.intent,
        recommendedAction: input.output.recommendedAction,
        confidence: new Prisma.Decimal(input.output.confidence.toFixed(2)),
        summary: input.output.summary,
        draftResponse: input.output.draftResponse,
        requiresHumanReview: true,
        humanHandoffRequired,
        provider: input.metadata.providerName,
        model: input.metadata.model,
        inputContext: input.inputContext,
        output: input.output,
        failureCode: null,
        failureMessage: null
      }
    });
    await tx.inboundEmail.update({
      where: { id: input.inbound.id },
      data: { replyProcessingStatus: "PROCESSED" }
    });
    if (input.output.intent === "NOT_INTERESTED") {
      await tx.conversation.update({
        where: { id: conversationId },
        data: { mode: "PAUSED" }
      });
      await stopLeadAutomationForCustomerIntent({
        client: tx,
        leadId: input.inbound.lead.id,
        reason: "CUSTOMER_NOT_INTERESTED"
      });
      const explicitDnc = hasExplicitDncStopSignal(input.inbound.textBody);
      if (explicitDnc) {
        await tx.contact.update({
          where: { id: input.inbound.lead.contactId },
          data: { doNotContact: true }
        });
        if (input.inbound.lead.contact.email && input.inbound.lead.contact.normalizedEmail) {
          await tx.emailSuppression.upsert({
            where: { normalizedEmail: input.inbound.lead.contact.normalizedEmail },
            create: {
              email: input.inbound.lead.contact.email,
              normalizedEmail: input.inbound.lead.contact.normalizedEmail,
              reason: "UNSUBSCRIBE",
              source: "CUSTOMER_REPLY",
              provider: input.inbound.provider,
              providerEventId: input.inbound.providerEventId
            },
            update: {
              reason: "UNSUBSCRIBE",
              source: "CUSTOMER_REPLY",
              provider: input.inbound.provider,
              providerEventId: input.inbound.providerEventId
            }
          });
        }
      }
    }
    if (humanHandoffRequired) {
      await tx.conversation.update({
        where: { id: conversationId },
        data: { mode: "HUMAN" }
      });
    }
    if (input.output.intent === "NEGOTIATION") {
      await createNegotiationHandoffForReply({
        client: tx,
        lead: input.inbound.lead,
        conversationId,
        replyProcessingRunId: run.id,
        summary: input.output.summary,
        inboundEmailId: input.inbound.id
      });
    }
    await tx.auditEvent.create({
      data: {
        actorType: "SYSTEM",
        entityType: "ReplyProcessingRun",
        entityId: run.id,
        action: input.output.intent === "NEGOTIATION" ? "NEGOTIATION_DETECTED" : "REPLY_UNDERSTOOD",
        after: {
          inboundEmailId: input.inbound.id,
          intent: input.output.intent,
          recommendedAction: input.output.recommendedAction,
          sent: false
        }
      }
    });
    await publishDomainEvent({
      client: tx,
      eventType:
        input.output.intent === "NEGOTIATION" ? "NEGOTIATION_DETECTED" : "REPLY_UNDERSTOOD",
      aggregateType: "ReplyProcessingRun",
      aggregateId: run.id,
      correlationId: input.inbound.id,
      idempotencyKey: `domain-event:reply-processing:${input.inbound.id}:completed`,
      payload: {
        inboundEmailId: input.inbound.id,
        leadId: input.inbound.leadId,
        conversationId: input.inbound.conversationId,
        intent: input.output.intent,
        recommendedAction: input.output.recommendedAction,
        requiresHumanReview: true,
        sent: false
      }
    });
    return run;
  }, replyProcessingTransactionOptions);
}
