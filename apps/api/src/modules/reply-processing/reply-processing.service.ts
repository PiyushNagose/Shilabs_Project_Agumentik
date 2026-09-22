import { Prisma } from "@prisma/client";
import type { ReplyProcessingRunDto } from "@shilabs/shared-types";
import { getAIConfig } from "../../config/ai.js";
import { AppError } from "../../shared/errors.js";
import { prisma } from "../../shared/prisma.js";
import { createAIProvider } from "../ai/ai.factory.js";
import type { AIProvider, ReplyUnderstandingResult } from "../ai/ai.provider.js";
import { replyUnderstandingResultSchema } from "../ai/ai.schemas.js";
import { publishDomainEvent } from "../domain-events/domain-events.service.js";
import { listApprovedKnowledge } from "../knowledge-base/knowledge-base.service.js";
import { createNegotiationHandoffForReply } from "../notifications/notification.service.js";

interface ProcessReplyOptions {
  provider?: AIProvider;
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

function providerMetadata(env: NodeJS.ProcessEnv | undefined, provider?: AIProvider): {
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
    if (!message?.body.includes(evidence.quote)) {
      throw new AppError(502, "PROVIDER_ERROR", "AI reply evidence was not grounded in messages");
    }
  }
  for (const id of input.output.usedKnowledgeIds) {
    if (!input.approvedKnowledgeIds.has(id)) {
      throw new AppError(502, "PROVIDER_ERROR", "AI referenced unapproved knowledge");
    }
  }
}

function actionForIntent(intent: ReplyUnderstandingResult["intent"]): ReplyUnderstandingResult["recommendedAction"] {
  if (intent === "NOT_INTERESTED") return "STOP_AUTOMATION";
  if (intent === "NEGOTIATION") return "HUMAN_HANDOFF";
  if (intent === "PROPOSAL_REQUEST") return "PROPOSAL_REVIEW";
  if (intent === "MEETING_REQUEST") return "MEETING_REVIEW";
  if (intent === "UNCLEAR") return "NO_ACTION";
  return "DRAFT_RESPONSE";
}

function safeOutput(output: ReplyUnderstandingResult): ReplyUnderstandingResult {
  const recommendedAction = actionForIntent(output.intent);
  const humanHandoff =
    output.intent === "NEGOTIATION" ||
    output.intent === "PROPOSAL_REQUEST" ||
    output.intent === "MEETING_REQUEST";
  return {
    ...output,
    recommendedAction,
    requiresHumanReview: true,
    draftResponse: humanHandoff || output.intent === "NOT_INTERESTED" ? null : output.draftResponse
  };
}

export async function processInboundReply(
  inboundEmailId: string,
  options?: ProcessReplyOptions
): Promise<ReplyProcessingRunDto> {
  const idempotencyKey = `reply-processing:inbound:${inboundEmailId}`;
  const existing = await prisma.replyProcessingRun.findUnique({ where: { idempotencyKey } });
  if (existing) return toDto(existing);

  const inbound = await prisma.inboundEmail.findUnique({
    where: { id: inboundEmailId },
    include: {
      lead: { include: { company: true, contact: true } },
      conversation: true,
      message: true
    }
  });
  if (!inbound?.lead || !inbound.conversation || !inbound.message) {
    throw new AppError(409, "CONFLICT", "Inbound email is not eligible for reply processing");
  }
  const eligibleInbound: EligibleReplyInboundRecord = inbound as EligibleReplyInboundRecord;

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
      contact: `${eligibleInbound.lead.contact.firstName} ${eligibleInbound.lead.contact.lastName}`.trim(),
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
      approvedKnowledge: approvedKnowledge.map((item) => ({ id: item.versionId, content: item.content }))
    });
    const parsed = replyUnderstandingResultSchema.parse(rawOutput);
    validateGrounding({
      output: parsed,
      messages,
      approvedKnowledgeIds
    });
    const output = safeOutput(parsed);
    const run = await persistSuccessfulRun({
      inbound: eligibleInbound,
      idempotencyKey,
      inputContext,
      output,
      metadata
    });
    return toDto(run);
  } catch (error) {
    const run = await createFailedRun({
      inbound: eligibleInbound,
      idempotencyKey,
      inputContext,
      code: error instanceof AppError ? error.code : "PROVIDER_ERROR",
      message: error instanceof Error ? error.message : "Reply processing failed",
      metadata
    });
    return toDto(run);
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
    const run = await tx.replyProcessingRun.create({
      data: {
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
  });
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
    const humanHandoffRequired = input.output.recommendedAction === "HUMAN_HANDOFF";
    const run = await tx.replyProcessingRun.create({
      data: {
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
        action:
          input.output.intent === "NEGOTIATION"
            ? "NEGOTIATION_DETECTED"
            : "REPLY_UNDERSTOOD",
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
        input.output.intent === "NEGOTIATION"
          ? "NEGOTIATION_DETECTED"
          : "REPLY_UNDERSTOOD",
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
  });
}
