import { Prisma } from "@prisma/client";
import {
  createExpiringVoiceStreamToken,
  getMessagingConfig,
  getVoiceConfig,
  type VoiceConfig
} from "@shilabs/shared-config";
import { getAIConfig } from "../../config/ai.js";
import { AppError } from "../../shared/errors.js";
import { prisma } from "../../shared/prisma.js";
import { createAIProvider } from "../ai/ai.factory.js";
import type { AIProvider, ReplyUnderstandingResult } from "../ai/ai.provider.js";
import { replyUnderstandingResultSchema } from "../ai/ai.schemas.js";
import { publishDomainEvent } from "../domain-events/domain-events.service.js";
import { appendActivityToZohoTimeline } from "../integrations/zoho-bigin/zoho-bigin-timeline.service.js";
import { listApprovedKnowledge } from "../knowledge-base/knowledge-base.service.js";
import { createMeetingRequestForReply } from "../meetings/meeting.service.js";
import { createNegotiationHandoffForReply } from "../notifications/notification.service.js";
import { recalculateQualification } from "../qualification/qualification.service.js";
import {
  intentRequiresHumanReviewGate,
  safeReplyUnderstandingOutput
} from "../reply-processing/reply-policy.js";
import { orchestrateSalesConversationForReply } from "../sales-conversation/sales-conversation-orchestrator.service.js";
import { recalculateLeadScoreForSystem } from "../scoring/scoring.service.js";

export interface VoiceTranscriptTurn {
  speaker: "customer" | "assistant";
  text: string;
  at: string;
}

const voiceConversationTransactionOptions = { timeout: 20000 };

function configuredWebhookBase(config: VoiceConfig): string {
  return config.webhookBaseUrl.replace(/\/$/u, "");
}

function missingVoiceAiConfig(config: VoiceConfig): string[] {
  const missing: string[] = [];
  if (config.provider !== "exotel") missing.push("VOICE_PROVIDER=EXOTEL");
  if (!config.voiceAi.enabled) missing.push("VOICE_AI_ENABLED=true");
  if (config.voiceAi.provider === "openai_realtime") {
    if (!config.voiceAi.openaiApiKey) missing.push("VOICE_AI_OPENAI_API_KEY_OR_OPENAI_API_KEY");
    if (!config.voiceAi.model) missing.push("VOICE_AI_OPENAI_MODEL");
    if (!config.voiceAi.voice) missing.push("VOICE_AI_OPENAI_VOICE");
  }
  if (config.voiceAi.provider === "local_vosk_windows") {
    if (!config.voiceAi.localVoskModelPath) missing.push("VOICE_AI_LOCAL_VOSK_MODEL_PATH");
  }
  if (!config.voiceAi.streamToken) missing.push("VOICE_AI_STREAM_TOKEN");
  if (!config.exotel.webhookSecret) missing.push("EXOTEL_WEBHOOK_SECRET");
  if (!config.webhookBaseUrl) missing.push("VOICE_WEBHOOK_BASE_URL");
  return missing;
}

export function assertVoiceAiConfigured(config: VoiceConfig = getVoiceConfig()): void {
  const missing = missingVoiceAiConfig(config);
  if (missing.length > 0) {
    throw new AppError(503, "PROVIDER_ERROR", `Missing configuration: ${missing.join(", ")}`);
  }
}

export function buildExotelVoicebotStreamUrl(input: {
  query: Record<string, unknown>;
  env?: NodeJS.ProcessEnv;
}): { url: string } {
  const config = getVoiceConfig(input.env);
  assertVoiceAiConfigured(config);
  const base = configuredWebhookBase(config)
    .replace(/^http:/u, "ws:")
    .replace(/^https:/u, "wss:");
  const credential = createExpiringVoiceStreamToken({
    secret: config.voiceAi.streamToken,
    ttlSeconds: config.voiceAi.streamTokenTtlSeconds
  });
  const streamPath = `${config.exotel.voicebotStreamPath.replace(/\/$/u, "")}/${encodeURIComponent(credential)}`;
  const params = new URLSearchParams();
  params.set("sample-rate", String(config.voiceAi.sampleRate));
  for (const key of ["CallSid", "Sid", "From", "To", "CallFrom", "CallTo", "Direction"]) {
    const value = input.query[key];
    if (typeof value === "string" && value.trim()) params.set(key, value.trim());
  }
  return { url: `${base}${streamPath}?${params.toString()}` };
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

function normalizeTranscript(turns: VoiceTranscriptTurn[]): VoiceTranscriptTurn[] {
  return turns
    .map((turn) => ({ ...turn, text: turn.text.trim() }))
    .filter((turn) => turn.text.length > 0);
}

function renderFullTranscript(turns: VoiceTranscriptTurn[]): string {
  return turns
    .map((turn) => `${turn.speaker === "customer" ? "Customer" : "AI"}: ${turn.text}`)
    .join("\n");
}

function renderCustomerTranscript(turns: VoiceTranscriptTurn[]): string {
  return turns
    .filter((turn) => turn.speaker === "customer")
    .map((turn) => turn.text)
    .join("\n");
}

function validateGrounding(input: {
  output: ReplyUnderstandingResult;
  messages: { id: string; body: string }[];
  approvedKnowledgeIds: Set<string>;
}): void {
  for (const evidence of input.output.evidence) {
    const message = input.messages.find((item) => item.id === evidence.messageId);
    if (!message?.body.includes(evidence.quote)) {
      throw new AppError(
        502,
        "PROVIDER_ERROR",
        "AI voice evidence was not grounded in saved transcript"
      );
    }
  }
  for (const id of input.output.usedKnowledgeIds) {
    if (!input.approvedKnowledgeIds.has(id)) {
      throw new AppError(502, "PROVIDER_ERROR", "AI voice output referenced unapproved knowledge");
    }
  }
}

export async function startVoiceConversationRun(input: {
  providerCallId: string;
  payload: Prisma.InputJsonObject;
}): Promise<void> {
  const call = await prisma.voiceCallAttempt.findUnique({
    where: { providerCallId: input.providerCallId }
  });
  if (!call) return;
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.voiceConversationRun.upsert({
      where: { voiceCallAttemptId: call.id },
      create: {
        voiceCallAttemptId: call.id,
        leadId: call.leadId,
        status: "STARTED",
        provider: getVoiceConfig().voiceAi.provider,
        idempotencyKey: `voice-conversation:${call.id}`
      },
      update: { status: "STARTED", failureCode: null, failureMessage: null }
    });
    await tx.voiceProviderEvent.upsert({
      where: {
        provider_providerEventId: {
          provider: "EXOTEL",
          providerEventId: `exotel-stream:${input.providerCallId}:start`
        }
      },
      create: {
        provider: "EXOTEL",
        providerEventId: `exotel-stream:${input.providerCallId}:start`,
        providerCallId: input.providerCallId,
        callAttemptId: call.id,
        type: "VOICE_STREAM",
        payload: input.payload,
        processedAt: now
      },
      update: { processedAt: now }
    });
  });
}

async function markVoiceConversationFailed(input: {
  callId: string;
  leadId: string;
  code: string;
  message: string;
}): Promise<void> {
  const now = new Date();
  await prisma.voiceConversationRun.upsert({
    where: { voiceCallAttemptId: input.callId },
    create: {
      voiceCallAttemptId: input.callId,
      leadId: input.leadId,
      status: "FAILED",
      transcriptText: null,
      failureCode: input.code,
      failureMessage: input.message,
      idempotencyKey: `voice-conversation:${input.callId}`,
      completedAt: now
    },
    update: {
      status: "FAILED",
      failureCode: input.code,
      failureMessage: input.message,
      completedAt: now
    }
  });
  await prisma.voiceCallAttempt.update({
    where: { id: input.callId },
    data: {
      transcriptStatus: "FAILED",
      failureCode: input.code,
      failureMessage: input.message
    }
  });
}

export async function finalizeVoiceConversationRun(input: {
  providerCallId: string;
  turns: VoiceTranscriptTurn[];
  env?: NodeJS.ProcessEnv;
  provider?: AIProvider;
}): Promise<void> {
  const call = await prisma.voiceCallAttempt.findUnique({
    where: { providerCallId: input.providerCallId },
    include: { lead: { include: { company: true, contact: true, owner: true } } }
  });
  if (!call) return;
  const existing = await prisma.voiceConversationRun.findUnique({
    where: { voiceCallAttemptId: call.id }
  });
  if (existing?.status === "COMPLETED") return;

  const turns = normalizeTranscript(input.turns);
  const customerTranscript = renderCustomerTranscript(turns);
  const fullTranscript = renderFullTranscript(turns);
  if (!customerTranscript) {
    await markVoiceConversationFailed({
      callId: call.id,
      leadId: call.leadId,
      code: "TRANSCRIPT_EMPTY",
      message: "Voice AI conversation ended without a customer transcript"
    });
    return;
  }

  let metadata: { providerName: string; model: string };
  try {
    metadata = providerMetadata(input.env, input.provider);
  } catch (error) {
    await markVoiceConversationFailed({
      callId: call.id,
      leadId: call.leadId,
      code: "AI_NOT_CONFIGURED",
      message: error instanceof Error ? error.message : "AI provider is not configured"
    });
    return;
  }

  const now = new Date();
  const { conversation, message } = await prisma.$transaction(async (tx) => {
    const conversationRecord =
      (await tx.conversation.findFirst({
        where: { leadId: call.leadId, channel: "INTERNAL", status: "OPEN" },
        orderBy: { createdAt: "desc" }
      })) ??
      (await tx.conversation.create({
        data: { leadId: call.leadId, channel: "INTERNAL", mode: "AUTO", status: "OPEN" }
      }));
    const messageRecord = await tx.message.create({
      data: {
        conversationId: conversationRecord.id,
        direction: "INBOUND",
        senderType: "PROSPECT",
        body: customerTranscript,
        deliveryStatus: "DELIVERED",
        sentAt: now,
        deliveredAt: now,
        metadata: {
          source: "voice_ai_conversation",
          voiceCallAttemptId: call.id,
          providerCallId: input.providerCallId,
          fullTranscript: turns.map((turn) => ({
            speaker: turn.speaker,
            text: turn.text,
            at: turn.at
          }))
        } satisfies Prisma.InputJsonObject
      }
    });
    await tx.conversation.update({
      where: { id: conversationRecord.id },
      data: { lastMessageAt: now }
    });
    return { conversation: conversationRecord, message: messageRecord };
  });

  const approvedKnowledge = await listApprovedKnowledge({ limit: 20 });
  const approvedKnowledgeIds = new Set(approvedKnowledge.map((item) => item.versionId));
  const messages = [
    {
      id: message.id,
      senderType: "PROSPECT",
      body: message.body
    }
  ] satisfies { id: string; senderType: "PROSPECT"; body: string }[];
  const inputContext = {
    voiceCallAttemptId: call.id,
    providerCallId: input.providerCallId,
    lead: {
      id: call.lead.id,
      status: call.lead.status,
      source: call.lead.source,
      requirement: call.lead.requirement,
      serviceInterest: call.lead.serviceInterest,
      company: call.lead.company.name,
      contact: `${call.lead.contact.firstName} ${call.lead.contact.lastName}`.trim(),
      doNotContact: call.lead.contact.doNotContact
    },
    approvedKnowledgeIds: approvedKnowledge.map((item) => item.versionId)
  } satisfies Prisma.InputJsonObject;

  try {
    const provider = input.provider ?? createAIProvider(input.env);
    const parsed = replyUnderstandingResultSchema.parse(
      await provider.understandReply({
        messages,
        leadContext: JSON.stringify(inputContext),
        approvedKnowledge: approvedKnowledge.map((item) => ({
          id: item.versionId,
          content: item.content
        }))
      })
    );
    validateGrounding({ output: parsed, messages, approvedKnowledgeIds });
    const output = safeReplyUnderstandingOutput(parsed);
    await recalculateQualification(call.leadId, provider);
    await recalculateLeadScoreForSystem(call.leadId);

    const result = await prisma.$transaction(async (tx) => {
      const run = await tx.replyProcessingRun.upsert({
        where: { idempotencyKey: `reply-processing:voice-call:${call.id}` },
        create: {
          leadId: call.leadId,
          conversationId: conversation.id,
          messageId: message.id,
          inboundEmailId: null,
          status: "COMPLETED",
          intent: output.intent,
          recommendedAction: output.recommendedAction,
          confidence: new Prisma.Decimal(output.confidence.toFixed(2)),
          summary: output.summary,
          draftResponse: output.draftResponse,
          requiresHumanReview: true,
          humanHandoffRequired: intentRequiresHumanReviewGate(output.intent),
          provider: metadata.providerName,
          model: metadata.model,
          inputContext,
          output,
          idempotencyKey: `reply-processing:voice-call:${call.id}`
        },
        update: {
          status: "COMPLETED",
          intent: output.intent,
          recommendedAction: output.recommendedAction,
          confidence: new Prisma.Decimal(output.confidence.toFixed(2)),
          summary: output.summary,
          draftResponse: output.draftResponse,
          requiresHumanReview: true,
          humanHandoffRequired: intentRequiresHumanReviewGate(output.intent),
          provider: metadata.providerName,
          model: metadata.model,
          inputContext,
          output,
          failureCode: null,
          failureMessage: null
        }
      });
      if (intentRequiresHumanReviewGate(output.intent)) {
        await tx.conversation.update({ where: { id: conversation.id }, data: { mode: "HUMAN" } });
      } else if (output.intent === "NOT_INTERESTED") {
        await tx.conversation.update({ where: { id: conversation.id }, data: { mode: "PAUSED" } });
      }
      if (output.intent === "NEGOTIATION") {
        await createNegotiationHandoffForReply({
          client: tx,
          lead: call.lead,
          conversationId: conversation.id,
          replyProcessingRunId: run.id,
          summary: output.summary,
          inboundEmailId: null
        });
      }
      const voiceRun = await tx.voiceConversationRun.upsert({
        where: { voiceCallAttemptId: call.id },
        create: {
          voiceCallAttemptId: call.id,
          leadId: call.leadId,
          conversationId: conversation.id,
          messageId: message.id,
          replyProcessingRunId: run.id,
          status: "COMPLETED",
          provider: getVoiceConfig(input.env).voiceAi.provider,
          model: getVoiceConfig(input.env).voiceAi.model,
          transcriptText: fullTranscript,
          outcome: output,
          intent: output.intent,
          recommendedAction: output.recommendedAction,
          summary: output.summary,
          humanHandoffRequired: intentRequiresHumanReviewGate(output.intent),
          idempotencyKey: `voice-conversation:${call.id}`,
          completedAt: now
        },
        update: {
          conversationId: conversation.id,
          messageId: message.id,
          replyProcessingRunId: run.id,
          status: "COMPLETED",
          provider: getVoiceConfig(input.env).voiceAi.provider,
          model: getVoiceConfig(input.env).voiceAi.model,
          transcriptText: fullTranscript,
          outcome: output,
          intent: output.intent,
          recommendedAction: output.recommendedAction,
          summary: output.summary,
          humanHandoffRequired: intentRequiresHumanReviewGate(output.intent),
          failureCode: null,
          failureMessage: null,
          completedAt: now
        }
      });
      await tx.voiceCallAttempt.update({
        where: { id: call.id },
        data: {
          transcriptStatus: "AVAILABLE",
          transcriptText: fullTranscript,
          transcriptProviderId: getVoiceConfig(input.env).voiceAi.provider
        }
      });
      const activity = await tx.activity.create({
        data: {
          leadId: call.leadId,
          type: "CALL_CONVERSATION_COMPLETED",
          description: `AI voice conversation completed: ${output.summary}`
        }
      });
      await tx.auditEvent.create({
        data: {
          actorType: "SYSTEM",
          entityType: "VoiceConversationRun",
          entityId: voiceRun.id,
          action: "VOICE_CONVERSATION_COMPLETED",
          after: {
            voiceCallAttemptId: call.id,
            providerCallId: input.providerCallId,
            intent: output.intent,
            recommendedAction: output.recommendedAction
          }
        }
      });
      await publishDomainEvent({
        client: tx,
        eventType: "VOICE_CONVERSATION_COMPLETED",
        aggregateType: "VoiceConversationRun",
        aggregateId: voiceRun.id,
        correlationId: call.id,
        idempotencyKey: `domain-event:voice-conversation:${call.id}:completed`,
        payload: {
          leadId: call.leadId,
          voiceCallAttemptId: call.id,
          replyProcessingRunId: run.id,
          intent: output.intent,
          recommendedAction: output.recommendedAction
        }
      });
      if (output.intent === "INTERESTED" || output.intent === "QUESTION") {
        const callingAttempt = await tx.callingAttempt.findUnique({
          where: { voiceCallAttemptId: call.id },
          select: { id: true, sequenceId: true }
        });
        if (callingAttempt && getMessagingConfig(input.env).provider === "twilio_whatsapp") {
          await tx.domainEventOutbox.upsert({
            where: { idempotencyKey: `domain-event:voice-whatsapp:${call.id}` },
            create: {
              eventType: "WHATSAPP_SEND_REQUESTED",
              aggregateType: "CallingAttempt",
              aggregateId: callingAttempt.id,
              payload: {
                leadId: call.leadId,
                contactId: call.contactId,
                callingSequenceId: callingAttempt.sequenceId,
                callingAttemptId: callingAttempt.id,
                voiceCallAttemptId: call.id,
                source: "VOICE_CONVERSATION_COMPLETED"
              },
              correlationId: call.id,
              idempotencyKey: `domain-event:voice-whatsapp:${call.id}`,
              nextAttemptAt: now,
              maxAttempts: 5
            },
            update: {
              nextAttemptAt: now,
              status: "PENDING",
              lastErrorCode: null,
              lastErrorMessage: null
            }
          });
        }
      }
      return { activityId: activity.id, replyProcessingRunId: run.id, voiceRunId: voiceRun.id };
    }, voiceConversationTransactionOptions);

    if (output.intent === "MEETING_REQUEST") {
      await createMeetingRequestForReply({
        leadId: call.leadId,
        conversationId: conversation.id,
        replyProcessingRunId: result.replyProcessingRunId,
        inboundEmailId: null,
        summary: output.summary
      });
    }
    await orchestrateSalesConversationForReply(result.replyProcessingRunId, {
      aiProvider: provider,
      env: input.env
    });
    const zohoTimeline = await appendActivityToZohoTimeline({
      activityId: result.activityId
    }).catch((error: unknown) => ({
      status: "FAILED",
      lastError: error instanceof Error ? error.message : "Zoho timeline sync failed"
    }));
    if (zohoTimeline.status === "FAILED") {
      await prisma.auditEvent.create({
        data: {
          actorType: "SYSTEM",
          entityType: "VoiceConversationRun",
          entityId: result.voiceRunId,
          action: "VOICE_ZOHO_TIMELINE_SYNC_FAILED",
          after: { error: zohoTimeline.lastError }
        }
      });
    }
  } catch (error) {
    await markVoiceConversationFailed({
      callId: call.id,
      leadId: call.leadId,
      code: error instanceof AppError ? error.code : "VOICE_AI_PROCESSING_FAILED",
      message: error instanceof Error ? error.message : "Voice AI processing failed"
    });
  }
}
