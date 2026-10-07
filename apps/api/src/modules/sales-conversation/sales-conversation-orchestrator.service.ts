import { Prisma, UserRole, UserStatus } from "@prisma/client";
import { AppError } from "../../shared/errors.js";
import { prisma } from "../../shared/prisma.js";
import type { AIProvider } from "../ai/ai.provider.js";
import { createAIProvider } from "../ai/ai.factory.js";
import { listApprovedKnowledge } from "../knowledge-base/knowledge-base.service.js";
import { sendOutboundEmail } from "../email/email.service.js";
import type { EmailProvider } from "../email/email.provider.js";
import type { AuthenticatedUser } from "../auth/auth.types.js";
import { generateProposal } from "../proposals/proposal-generation.service.js";
import { publishRealtimeEvent } from "../realtime/realtime.service.js";

export interface SalesConversationOrchestrationOptions {
  aiProvider?: AIProvider;
  emailProvider?: EmailProvider;
  env?: NodeJS.ProcessEnv;
}

type ReplyRun = Prisma.ReplyProcessingRunGetPayload<{
  include: {
    lead: { include: { company: true; contact: true; owner: true } };
    conversation: true;
    message: true;
  }
}>;

const AI_STAGE_BY_INTENT: Partial<Record<NonNullable<ReplyRun["intent"]>, string>> = {
  QUESTION: "ENGAGED",
  INTERESTED: "QUALIFIED",
  MEETING_REQUEST: "QUALIFIED",
  PROPOSAL_REQUEST: "PROPOSAL",
  NEGOTIATION: "NEGOTIATION",
  NOT_INTERESTED: "NURTURE"
};

const orchestrationTransactionOptions = { maxWait: 10000, timeout: 30000 };

function isTerminalLead(status: string): boolean {
  return ["WON", "LOST", "DISQUALIFIED"].includes(status);
}

async function alreadyOrchestrated(runId: string): Promise<boolean> {
  const existing = await prisma.auditEvent.findFirst({
    where: {
      entityType: "ReplyProcessingRun",
      entityId: runId,
      action: "PHASE1_ORCHESTRATION_COMPLETED"
    },
    select: { id: true }
  });
  return Boolean(existing);
}

async function resolveSystemActor(run: ReplyRun): Promise<AuthenticatedUser> {
  if (run.lead.owner?.status === UserStatus.ACTIVE) {
    return run.lead.owner;
  }
  const admin = await prisma.user.findFirst({
    where: { role: UserRole.ADMIN, status: UserStatus.ACTIVE },
    orderBy: { createdAt: "asc" }
  });
  if (!admin) throw new AppError(409, "CONFLICT", "No active system actor is available");
  return admin;
}

function responseSubject(run: ReplyRun): string {
  const subject = run.inboundEmailId ? "Re: Your Shilabs enquiry" : `Re: ${run.lead.company.name}`;
  return subject;
}

async function recordSkipped(input: { run: ReplyRun; code: string; message: string }): Promise<void> {
  await prisma.auditEvent.create({
    data: {
      actorType: "SYSTEM",
      entityType: "ReplyProcessingRun",
      entityId: input.run.id,
      action: "PHASE1_ORCHESTRATION_COMPLETED",
      after: {
        leadId: input.run.leadId,
        conversationId: input.run.conversationId,
        action: "SKIPPED",
        code: input.code,
        message: input.message
      }
    }
  });
}

async function publishNextActionChanged(leadId: string): Promise<void> {
  await publishRealtimeEvent({
    entityType: "lead",
    action: "lead-next-action-updated",
    leadId
  });
}

async function advanceLeadStageForAI(input: {
  leadId: string;
  intent: ReplyRun["intent"];
}): Promise<void> {
  if (!input.intent) return;
  const targetKey = AI_STAGE_BY_INTENT[input.intent];
  if (!targetKey) return;

  const result = await prisma.$transaction(async (tx) => {
    const lead = await tx.lead.findUnique({ where: { id: input.leadId }, include: { stage: true } });
    const targetStage = lead?.workspaceId
      ? await tx.pipelineStage.findFirst({ where: { workspaceId: lead.workspaceId, status: "ACTIVE", pipeline: { status: "ACTIVE" }, OR: [{ key: targetKey }, { semanticKey: targetKey }] } })
      : null;
    if (!lead || !targetStage || ["WON", "LOST", "DISQUALIFIED"].includes(lead.status)) {
      return null;
    }

    const shouldMove =
      (targetStage.semanticKey ?? targetStage.key) === "NURTURE"
        ? (lead.stage.semanticKey ?? lead.stage.key) !== "NURTURE"
        : (lead.stage.semanticKey ?? lead.stage.key) === "NURTURE" || targetStage.order > lead.stage.order;
    if (!shouldMove) return null;

    const nextStatus = targetStage.key === "NURTURE" ? "NURTURE" : "OPEN";
    const updated = await tx.lead.update({
      where: { id: lead.id },
      data: { stageId: targetStage.id, status: nextStatus, lastActivityAt: new Date() },
      include: { stage: true }
    });
    await tx.activity.create({
      data: {
        leadId: lead.id,
        type: "STAGE_CHANGED",
        description: `AI moved stage from ${lead.stage.label} to ${targetStage.label}`
      }
    });
    await tx.auditEvent.create({
      data: {
        actorType: "SYSTEM",
        entityType: "Lead",
        entityId: lead.id,
        action: "AI_STAGE_CHANGED",
        before: { stageId: lead.stageId, stageKey: lead.stage.key, status: lead.status },
        after: { stageId: updated.stageId, stageKey: updated.stage.key, status: updated.status, intent: input.intent }
      }
    });
    return updated;
  }, orchestrationTransactionOptions);

  if (result) {
    await publishRealtimeEvent({ entityType: "lead", action: "lead-stage-changed", leadId: input.leadId });
  }
}

async function recordFailure(input: {
  run: ReplyRun;
  code: string;
  message: string;
  action: string;
}): Promise<void> {
  await prisma.auditEvent.create({
    data: {
      actorType: "SYSTEM",
      entityType: "ReplyProcessingRun",
      entityId: input.run.id,
      action: "PHASE1_ORCHESTRATION_FAILED",
      after: {
        leadId: input.run.leadId,
        conversationId: input.run.conversationId,
        selectedAction: input.action,
        code: input.code,
        message: input.message
      }
    }
  });
  await prisma.activity.create({
    data: {
      leadId: input.run.leadId,
      type: "MESSAGE_RECEIVED",
      description: `AI sales conversation orchestration failed: ${input.message}`
    }
  });
  await prisma.lead.update({
    where: { id: input.run.leadId },
    data: {
      nextAction: "Review AI response failure",
      nextActionAt: new Date(),
      lastActivityAt: new Date()
    }
  });
  await publishNextActionChanged(input.run.leadId);
}

async function recordCompleted(input: {
  run: ReplyRun;
  selectedAction: string;
  reason: string;
  entityType?: string | null;
  entityId?: string | null;
}): Promise<void> {
  await prisma.auditEvent.create({
    data: {
      actorType: "SYSTEM",
      entityType: "ReplyProcessingRun",
      entityId: input.run.id,
      action: "PHASE1_ORCHESTRATION_COMPLETED",
      after: {
        leadId: input.run.leadId,
        conversationId: input.run.conversationId,
        selectedAction: input.selectedAction,
        reason: input.reason,
        entityType: input.entityType ?? null,
        entityId: input.entityId ?? null
      }
    }
  });
}

async function buildAIInput(run: ReplyRun) {
  const [messages, qualification, proposals, meetings, voiceRuns, approvedKnowledge] =
    await Promise.all([
      prisma.message.findMany({
        where: { conversation: { leadId: run.leadId } },
        select: { id: true, senderType: true, body: true, direction: true, createdAt: true },
        orderBy: { createdAt: "asc" },
        take: 100
      }),
      prisma.leadQualification.findUnique({
        where: { leadId: run.leadId },
        include: { evidence: true }
      }),
      prisma.proposal.findMany({
        where: { leadId: run.leadId },
        select: { id: true, title: true, status: true, serviceType: true, createdAt: true },
        orderBy: { createdAt: "desc" },
        take: 10
      }),
      prisma.meetingRequest.findMany({
        where: { leadId: run.leadId },
        select: { id: true, status: true, title: true, providerSyncStatus: true, confirmedAt: true },
        orderBy: { createdAt: "desc" },
        take: 10
      }),
      prisma.voiceConversationRun.findMany({
        where: { leadId: run.leadId },
        select: { id: true, status: true, intent: true, recommendedAction: true, summary: true },
        orderBy: { createdAt: "desc" },
        take: 5
      }),
      listApprovedKnowledge({ limit: 30 })
    ]);

  return {
    messages: messages.map((message) => ({
      id: message.id,
      senderType: message.senderType,
      body: message.body
    })),
    approvedKnowledge: approvedKnowledge.map((item) => ({
      id: item.versionId,
      content: item.content
    })),
    leadContext: JSON.stringify({
      orchestrator: "PHASE_1_AI_SALES_CONVERSATION",
      allowedActions: [
        "SEND_GROUNDED_EMAIL_REPLY",
        "DRAFT_PROPOSAL_FOR_HUMAN_APPROVAL",
        "CREATE_MEETING_REQUEST",
        "HUMAN_HANDOFF",
        "STOP_AUTOMATION",
        "NO_ACTION"
      ],
      disallowedActions: [
        "NEGOTIATE_PRICE",
        "PROMISE_DISCOUNT",
        "SEND_PROPOSAL_WITHOUT_APPROVAL",
        "BOOK_MEETING_WITHOUT_CALENDAR_CONFIRMATION",
        "INVENT_FACTS"
      ],
      currentReplyProcessingRun: {
        id: run.id,
        intent: run.intent,
        recommendedAction: run.recommendedAction,
        summary: run.summary,
        draftResponse: run.draftResponse
      },
      lead: {
        id: run.lead.id,
        status: run.lead.status,
        source: run.lead.source,
        company: run.lead.company.name,
        contact: `${run.lead.contact.firstName} ${run.lead.contact.lastName}`.trim(),
        requirement: run.lead.requirement,
        serviceInterest: run.lead.serviceInterest,
        nextAction: run.lead.nextAction,
        doNotContact: run.lead.contact.doNotContact
      },
      conversation: {
        id: run.conversation.id,
        channel: run.conversation.channel,
        mode: run.conversation.mode,
        status: run.conversation.status
      },
      qualification,
      proposals,
      meetings,
      voiceRuns
    })
  };
}

async function sendAIEmailReply(input: {
  run: ReplyRun;
  actor: AuthenticatedUser;
  provider: AIProvider;
  emailProvider?: EmailProvider;
  env?: NodeJS.ProcessEnv;
}): Promise<void> {
  const reply = input.run.draftResponse
    ? {
        body: input.run.draftResponse,
        requiresHumanReview: false,
        reason: null
      }
    : await input.provider.generateSalesReply(await buildAIInput(input.run));
  if (reply.requiresHumanReview) {
    throw new AppError(
      409,
      "CONFLICT",
      reply.reason ?? "AI response requires human review"
    );
  }

  const idempotencyKey = `phase1-ai-reply:${input.run.id}`;
  const outbound = await sendOutboundEmail(
    input.actor,
    {
      leadId: input.run.leadId,
      subject: responseSubject(input.run),
      textBody: reply.body,
      idempotencyKey
    },
    { env: input.env, provider: input.emailProvider }
  );

  if (outbound.status !== "SENT") {
    throw new AppError(
      409,
      "CONFLICT",
      outbound.failureMessage ?? "AI reply was not sent"
    );
  }

  const now = new Date();
  const message = await prisma.message.upsert({
    where: { providerMessageId: outbound.providerMessageId ?? outbound.id },
    create: {
      conversationId: input.run.conversationId,
      providerMessageId: outbound.providerMessageId ?? outbound.id,
      direction: "OUTBOUND",
      senderType: "AI",
      body: reply.body,
      deliveryStatus: "SENT",
      sentAt: outbound.sentAt ? new Date(outbound.sentAt) : now,
      metadata: {
        source: "PHASE1_AI_ORCHESTRATOR",
        replyProcessingRunId: input.run.id,
        outboundEmailId: outbound.id,
        idempotencyKey
      }
    },
    update: {}
  });

  await prisma.$transaction(async (tx) => {
    await tx.conversation.update({
      where: { id: input.run.conversationId },
      data: { lastMessageAt: message.sentAt ?? message.createdAt }
    });
    await tx.lead.update({
      where: { id: input.run.leadId },
      data: {
        nextAction: "Await customer response",
        nextActionAt: null,
        lastActivityAt: message.sentAt ?? message.createdAt
      }
    });
    await tx.auditEvent.create({
      data: {
        actorType: "SYSTEM",
        entityType: "Message",
        entityId: message.id,
        action: "AI_REPLY_SENT",
        after: {
          replyProcessingRunId: input.run.id,
          outboundEmailId: outbound.id,
          providerMessageId: outbound.providerMessageId
        }
      }
    });
  }, orchestrationTransactionOptions);
  await publishNextActionChanged(input.run.leadId);

  await recordCompleted({
    run: input.run,
    selectedAction: "SEND_GROUNDED_EMAIL_REPLY",
    reason: "Safe customer reply intent with generated response accepted by EmailProvider",
    entityType: "Message",
    entityId: message.id
  });
}

async function createProposalForApproval(input: {
  run: ReplyRun;
  actor: AuthenticatedUser;
  provider: AIProvider;
  env?: NodeJS.ProcessEnv;
}): Promise<void> {
  const generated = await generateProposal(
    input.actor,
    {
      leadId: input.run.leadId,
      kind: "GENERAL",
      additionalContext: input.run.summary ?? undefined,
      idempotencyKey: `phase1-proposal:${input.run.id}`
    },
    { aiProvider: input.provider, env: input.env }
  );
  const proposal = generated.proposal;
  if (proposal?.status !== "WAITING_APPROVAL") {
    throw new AppError(
      409,
      "CONFLICT",
      "AI proposal did not reach WAITING_APPROVAL"
    );
  }

  await prisma.lead.update({
    where: { id: input.run.leadId },
    data: {
      nextAction: "Review AI-generated proposal",
      nextActionAt: null,
      lastActivityAt: new Date()
    }
  });
  await publishNextActionChanged(input.run.leadId);
  await recordCompleted({
    run: input.run,
    selectedAction: "DRAFT_PROPOSAL_FOR_HUMAN_APPROVAL",
    reason: "Customer requested a proposal; existing proposal workflow created human approval gate",
    entityType: "Proposal",
    entityId: proposal.id
  });
}

async function updateLeadNextAction(input: {
  run: ReplyRun;
  nextAction: string | null;
  selectedAction: string;
  reason: string;
}): Promise<void> {
  await prisma.lead.update({
    where: { id: input.run.leadId },
    data: {
      nextAction: input.nextAction,
      nextActionAt: null,
      lastActivityAt: new Date()
    }
  });
  await publishNextActionChanged(input.run.leadId);
  await recordCompleted({
    run: input.run,
    selectedAction: input.selectedAction,
    reason: input.reason
  });
}

export async function orchestrateSalesConversationForReply(
  replyProcessingRunId: string,
  options?: SalesConversationOrchestrationOptions
): Promise<void> {
  const run = await prisma.replyProcessingRun.findUnique({
    where: { id: replyProcessingRunId },
    include: {
      lead: { include: { company: true, contact: true, owner: true } },
      conversation: true,
      message: true
    }
  });
  if (run?.status !== "COMPLETED") return;
  if (await alreadyOrchestrated(run.id)) return;

  if (isTerminalLead(run.lead.status)) {
    await recordSkipped({
      run,
      code: "TERMINAL_LEAD_STATE",
      message: `Lead status ${run.lead.status} blocks automation`
    });
    return;
  }
  if (run.lead.contact.doNotContact) {
    await recordSkipped({
      run,
      code: "DO_NOT_CONTACT",
      message: "Contact is marked do-not-contact"
    });
    return;
  }
  const activeTakeover = await prisma.humanTakeover.findFirst({
    where: {
      status: "ACTIVE",
      OR: [{ leadId: run.leadId }, { conversationId: run.conversationId }]
    },
    select: { id: true }
  });
  if (activeTakeover && run.intent !== "NEGOTIATION") {
    await recordSkipped({
      run,
      code: "HUMAN_TAKEOVER_ACTIVE",
      message: "Human takeover blocks automated AI response"
    });
    return;
  }

  try {
    await advanceLeadStageForAI({ leadId: run.leadId, intent: run.intent });
    if (run.intent === "NEGOTIATION") {
      await updateLeadNextAction({
        run,
        nextAction: "Human follow-up required",
        selectedAction: "HUMAN_HANDOFF",
        reason: "Negotiation/commercial intent is never handled by AI"
      });
      return;
    }
    if (run.intent === "NOT_INTERESTED") {
      await updateLeadNextAction({
        run,
        nextAction: null,
        selectedAction: "STOP_AUTOMATION",
        reason: "Prospect is not interested"
      });
      return;
    }
    if (run.intent === "MEETING_REQUEST") {
      await updateLeadNextAction({
        run,
        nextAction: "Review meeting request",
        selectedAction: "CREATE_MEETING_REQUEST",
        reason: "Existing meeting workflow owns availability and confirmation"
      });
      return;
    }
    if (run.intent === "PROPOSAL_REQUEST") {
      const actor = await resolveSystemActor(run);
      const aiProvider = options?.aiProvider ?? createAIProvider(options?.env);
      await createProposalForApproval({
        run,
        actor,
        provider: aiProvider,
        env: options?.env
      });
      return;
    }
    if (run.intent === "INTERESTED" || run.intent === "QUESTION") {
      if (run.conversation.mode !== "AUTO") {
        await updateLeadNextAction({
          run,
          nextAction: run.conversation.mode === "CLOSED" ? null : "Human follow-up required",
          selectedAction: "CONVERSATION_MODE_GATE",
          reason: `Conversation mode ${run.conversation.mode} blocks automated AI response`
        });
        return;
      }
      if (run.conversation.channel === "EMAIL") {
        const actor = await resolveSystemActor(run);
        const aiProvider = options?.aiProvider ?? createAIProvider(options?.env);
        await sendAIEmailReply({
          run,
          actor,
          provider: aiProvider,
          emailProvider: options?.emailProvider,
          env: options?.env
        });
        return;
      }
      if (run.conversation.channel === "INTERNAL") {
        await updateLeadNextAction({
          run,
          nextAction: "WhatsApp follow-up queued",
          selectedAction: "WHATSAPP_SEND_REQUESTED",
          reason: "Approved Twilio WhatsApp follow-up was queued after the AI voice conversation"
        });
        return;
      }
      await updateLeadNextAction({
        run,
        nextAction: "Review WhatsApp AI response policy",
        selectedAction: "WHATSAPP_POLICY_GATE",
        reason: "WhatsApp free-form response policy is not resolved in the existing provider boundary"
      });
      return;
    }
    await updateLeadNextAction({
      run,
      nextAction: "Review unclear customer reply",
      selectedAction: "NO_ACTION",
      reason: "Reply intent was unclear"
    });
  } catch (error) {
    await recordFailure({
      run,
      action: run.recommendedAction ?? "UNKNOWN",
      code: error instanceof AppError ? error.code : "PHASE1_ORCHESTRATION_FAILED",
      message: error instanceof Error ? error.message : "Phase 1 orchestration failed"
    });
  }
}
