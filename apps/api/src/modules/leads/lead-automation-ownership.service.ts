import type { AuditActorType, LeadAutomationOwnershipState, Prisma } from "@prisma/client";
import { AppError } from "../../shared/errors.js";
import { prisma } from "../../shared/prisma.js";
import { publishRealtimeEvent } from "../realtime/realtime.service.js";

type TransactionClient = Prisma.TransactionClient;

interface TransitionInput {
  client: TransactionClient;
  leadId: string;
  state: LeadAutomationOwnershipState;
  reason: string;
  actorType: AuditActorType;
  actorId?: string | null;
  sourceType: string;
  sourceId?: string | null;
  correlationId?: string | null;
}

type CompleteHumanActionInput = Omit<TransitionInput, "state"> & {
  allowStoppedResume?: boolean;
};

export function isTerminalLeadStatus(status: string): boolean {
  return status === "WON" || status === "LOST" || status === "DISQUALIFIED";
}

async function transitionInTransaction(input: TransitionInput): Promise<boolean> {
  const lead = await input.client.lead.findUnique({
    where: { id: input.leadId },
    select: {
      id: true,
      workspaceId: true,
      automationOwnershipState: true,
      automationOwnershipReason: true
    }
  });
  if (!lead) throw new AppError(404, "NOT_FOUND", "Lead not found");
  if (!lead.workspaceId) {
    throw new AppError(409, "CONFLICT", "Lead has no persisted workspace");
  }
  if (
    lead.automationOwnershipState === input.state &&
    lead.automationOwnershipReason === input.reason
  ) {
    return false;
  }

  const changedAt = new Date();
  await input.client.lead.update({
    where: { id: lead.id },
    data: {
      automationOwnershipState: input.state,
      automationOwnershipChangedAt: changedAt,
      automationOwnershipReason: input.reason,
      lastActivityAt: changedAt
    }
  });
  await input.client.activity.create({
    data: {
      workspaceId: lead.workspaceId,
      leadId: lead.id,
      actorType: input.actorType,
      actorUserId: input.actorType === "USER" ? (input.actorId ?? null) : null,
      sourceType: input.sourceType,
      sourceId: input.sourceId ?? null,
      type: "AUTOMATION_OWNERSHIP_CHANGED",
      title: "Automation ownership changed",
      description: `${lead.automationOwnershipState} to ${input.state}: ${input.reason}`,
      metadata: {
        from: lead.automationOwnershipState,
        to: input.state,
        reason: input.reason
      },
      correlationId: input.correlationId ?? null,
      visibility: "BUSINESS",
      occurredAt: changedAt
    }
  });
  await input.client.auditEvent.create({
    data: {
      workspaceId: lead.workspaceId,
      actorType: input.actorType,
      actorId: input.actorId ?? null,
      actorUserId: input.actorType === "USER" ? (input.actorId ?? null) : null,
      sourceType: input.sourceType,
      sourceId: input.sourceId ?? null,
      entityType: "Lead",
      entityId: lead.id,
      action: "AUTOMATION_OWNERSHIP_CHANGED",
      before: { state: lead.automationOwnershipState, reason: lead.automationOwnershipReason },
      after: { state: input.state, reason: input.reason },
      correlationId: input.correlationId ?? null
    }
  });
  return true;
}

async function stopPendingAutomation(
  client: TransactionClient,
  leadId: string,
  reason: string
): Promise<void> {
  const stoppedAt = new Date();
  const followUps = await client.followUpSequence.findMany({
    where: { leadId, status: "ACTIVE" },
    include: { attempts: { where: { status: "SCHEDULED" }, select: { domainEventId: true } } }
  });
  const calling = await client.callingSequence.findMany({
    where: { leadId, status: "ACTIVE" },
    include: { attempts: { where: { status: "SCHEDULED" }, select: { domainEventId: true } } }
  });
  const workflowExecutions = await client.workflowExecution.findMany({
    where: { leadId, status: { in: ["QUEUED", "RUNNING", "WAITING"] } },
    select: { id: true }
  });
  const eventIds = [...followUps, ...calling]
    .flatMap((sequence) => sequence.attempts.map((attempt) => attempt.domainEventId))
    .filter((id): id is string => Boolean(id));
  const workflowExecutionIds = workflowExecutions.map(({ id }) => id);
  const workflowEvents =
    workflowExecutionIds.length > 0
      ? await client.domainEventOutbox.findMany({
          where: {
            aggregateType: "WorkflowExecution",
            aggregateId: { in: workflowExecutionIds },
            status: { in: ["PENDING", "QUEUED", "PROCESSING"] }
          },
          select: { id: true }
        })
      : [];
  eventIds.push(...workflowEvents.map(({ id }) => id));

  await client.followUpSequence.updateMany({
    where: { leadId, status: "ACTIVE" },
    data: { status: "STOPPED", stopReason: reason, stoppedAt }
  });
  await client.followUpAttempt.updateMany({
    where: { leadId, status: "SCHEDULED" },
    data: {
      status: "CANCELLED",
      failedAt: stoppedAt,
      failureCode: reason,
      failureMessage: "Lead automation ownership no longer permits follow-up"
    }
  });
  await client.callingSequence.updateMany({
    where: { leadId, status: "ACTIVE" },
    data: { status: "STOPPED", stopReason: reason, stoppedAt }
  });
  await client.callingAttempt.updateMany({
    where: { leadId, status: "SCHEDULED" },
    data: {
      status: "SKIPPED",
      completedAt: stoppedAt,
      failureCode: reason,
      failureMessage: "Lead automation ownership no longer permits calling or WhatsApp"
    }
  });
  await client.workflowExecution.updateMany({
    where: { id: { in: workflowExecutionIds }, status: { in: ["QUEUED", "RUNNING", "WAITING"] } },
    data: {
      status: "CANCELED",
      completedAt: stoppedAt,
      failureCode: reason,
      failureMessage: "Centralized lead ownership stopped workflow execution"
    }
  });
  if (eventIds.length > 0) {
    await client.domainEventOutbox.updateMany({
      where: { id: { in: eventIds }, status: { in: ["PENDING", "QUEUED", "PROCESSING"] } },
      data: {
        status: "ATTENTION_REQUIRED",
        deadLetteredAt: stoppedAt,
        lastErrorCode: reason,
        lastErrorMessage: "Lead automation ownership stopped pending execution"
      }
    });
  }
}

export async function requireHumanActionInTransaction(
  input: Omit<TransitionInput, "state">
): Promise<void> {
  await stopPendingAutomation(input.client, input.leadId, input.reason);
  await input.client.conversation.updateMany({
    where: { leadId: input.leadId, status: "OPEN" },
    data: { mode: "HUMAN" }
  });
  await transitionInTransaction({ ...input, state: "HUMAN_REQUIRED" });
}

export async function activateHumanInTransaction(
  input: Omit<TransitionInput, "state">
): Promise<void> {
  await stopPendingAutomation(input.client, input.leadId, input.reason);
  await transitionInTransaction({ ...input, state: "HUMAN_ACTIVE" });
}

export async function stopAiInTransaction(input: Omit<TransitionInput, "state">): Promise<void> {
  await stopPendingAutomation(input.client, input.leadId, input.reason);
  await transitionInTransaction({ ...input, state: "AI_STOPPED" });
}

export async function completeHumanActionInTransaction(
  input: CompleteHumanActionInput
): Promise<{ activated: boolean }> {
  const lead = await input.client.lead.findUnique({
    where: { id: input.leadId },
    include: { contact: { select: { doNotContact: true } } }
  });
  if (!lead) throw new AppError(404, "NOT_FOUND", "Lead not found");
  if (lead.automationOwnershipState === "AI_STOPPED" && !input.allowStoppedResume) {
    return { activated: false };
  }
  if (lead.contact.doNotContact || isTerminalLeadStatus(lead.status)) {
    await stopAiInTransaction({
      ...input,
      reason: lead.contact.doNotContact ? "DO_NOT_CONTACT" : `LEAD_${lead.status}`
    });
    return { activated: false };
  }

  await transitionInTransaction({ ...input, state: "HUMAN_ACTION_COMPLETED" });
  const conversations = await input.client.conversation.findMany({
    where: { leadId: input.leadId, status: "OPEN" },
    select: { id: true }
  });
  if (conversations.length > 0) {
    await input.client.humanTakeover.deleteMany({
      where: { conversationId: { in: conversations.map((item) => item.id) }, status: "ACTIVE" }
    });
  }
  const activeHandoff = await input.client.negotiationHandoff.count({
    where: { leadId: input.leadId, status: { in: ["ACTIVE", "ATTENTION_REQUIRED"] } }
  });
  if (activeHandoff > 0) {
    await transitionInTransaction({
      ...input,
      state: "HUMAN_REQUIRED",
      reason: `${input.reason}:NEGOTIATION_HANDOFF_ACTIVE`
    });
    return { activated: false };
  }
  await input.client.conversation.updateMany({
    where: { leadId: input.leadId, status: "OPEN", mode: { in: ["HUMAN", "DRAFT_ONLY"] } },
    data: { mode: "AUTO" }
  });
  await transitionInTransaction({ ...input, state: "AI_ACTIVE" });
  return { activated: true };
}

export async function requireHumanAction(
  input: Omit<TransitionInput, "client" | "state">
): Promise<void> {
  await prisma.$transaction((client) => requireHumanActionInTransaction({ ...input, client }));
  await publishRealtimeEvent({
    entityType: "lead",
    action: "automation-ownership-changed",
    leadId: input.leadId
  });
}

export async function activateHuman(
  input: Omit<TransitionInput, "client" | "state">
): Promise<void> {
  await prisma.$transaction((client) => activateHumanInTransaction({ ...input, client }));
  await publishRealtimeEvent({
    entityType: "lead",
    action: "automation-ownership-changed",
    leadId: input.leadId
  });
}

export async function stopAi(input: Omit<TransitionInput, "client" | "state">): Promise<void> {
  await prisma.$transaction((client) => stopAiInTransaction({ ...input, client }));
  await publishRealtimeEvent({
    entityType: "lead",
    action: "automation-ownership-changed",
    leadId: input.leadId
  });
}

export async function completeHumanAction(
  input: Omit<CompleteHumanActionInput, "client">
): Promise<{ activated: boolean }> {
  const result = await prisma.$transaction((client) =>
    completeHumanActionInTransaction({ ...input, client })
  );
  await publishRealtimeEvent({
    entityType: "lead",
    action: "automation-ownership-changed",
    leadId: input.leadId
  });
  return result;
}
