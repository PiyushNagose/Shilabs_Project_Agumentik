import type { FollowUpSequenceDto } from "@shilabs/shared-types";
import { AppError } from "../../shared/errors.js";
import { prisma } from "../../shared/prisma.js";
import type { AIProvider } from "../ai/ai.provider.js";
import type { AuthenticatedUser } from "../auth/auth.types.js";
import { requireHumanActionInTransaction } from "../leads/lead-automation-ownership.service.js";
import { publishRealtimeEvent } from "../realtime/realtime.service.js";
import { startFollowUpSequence } from "./followup.service.js";

export interface LeadAiAutomationOptions {
  env?: NodeJS.ProcessEnv;
  provider?: AIProvider;
  now?: Date;
  cycleKey?: string;
}

function envFlagEnabled(value: string | undefined): boolean | null {
  if (value === undefined) return null;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return null;
}

export function shouldAutoStartLeadAiAutomation(env: NodeJS.ProcessEnv = process.env): boolean {
  const explicit = envFlagEnabled(env.AI_AUTOSTART_ON_LEAD_CREATE);
  if (explicit !== null) return explicit;
  if (env.APP_ENV === "e2e-local") return true;
  if (
    (env.NODE_ENV === "test" || env.VITEST === "true") &&
    env.AI_AUTOSTART_ON_LEAD_CREATE_IN_TEST !== "true"
  ) {
    return false;
  }
  return true;
}

async function markLeadAutomationStartupFailure(input: {
  leadId: string;
  code: string;
  message: string;
}): Promise<void> {
  const now = new Date();
  const workspaceId = await prisma.$transaction(async (tx) => {
    const lead = await tx.lead.findUnique({
      where: { id: input.leadId },
      select: {
        workspaceId: true,
        automationOwnershipState: true,
        status: true,
        contact: { select: { doNotContact: true } }
      }
    });
    if (
      !lead?.workspaceId ||
      lead.automationOwnershipState !== "AI_ACTIVE" ||
      lead.contact.doNotContact ||
      ["WON", "LOST", "DISQUALIFIED"].includes(lead.status)
    ) return null;
    const needsReview = input.code === "AI_FOLLOW_UP_REQUIRES_REVIEW" ||
      input.message === "A salesperson must review this follow-up.";
    const summary = needsReview
      ? "The suggested follow-up needs your approval before AI can continue."
      : "Automatic follow-up could not start. Review the integration and follow-up settings.";
    await requireHumanActionInTransaction({
      client: tx,
      leadId: input.leadId,
      reason: needsReview ? "FOLLOW_UP_REQUIRES_REVIEW" : "AI_AUTOMATION_START_FAILED",
      actorType: "SYSTEM",
      sourceType: "FOLLOW_UP"
    });
    await tx.lead.update({
      where: { id: input.leadId },
      data: {
        nextAction: needsReview ? "Review the suggested follow-up before replying" : "Review automatic follow-up settings",
        nextActionAt: now,
        lastActivityAt: now
      }
    });
    await tx.activity.create({
      data: {
        workspaceId: lead.workspaceId,
        leadId: input.leadId,
        actorType: "SYSTEM",
        sourceType: "FOLLOW_UP",
        type: "FOLLOW_UP_DECISION_RECORDED",
        title: needsReview ? "Follow-up needs your review" : "Automatic follow-up needs attention",
        description: summary,
        metadata: { decision: "ASK_HUMAN", code: input.code },
        visibility: "BUSINESS"
      }
    });
    await tx.auditEvent.create({
      data: {
        workspaceId: lead.workspaceId,
        actorType: "SYSTEM",
        entityType: "Lead",
        entityId: input.leadId,
        action: "AI_LEAD_AUTOMATION_START_FAILED",
        after: {
          code: input.code,
          message: input.message
        }
      }
    });
    return lead.workspaceId;
  }, { maxWait: 10_000, timeout: 30_000 });
  if (!workspaceId) return;
  await publishRealtimeEvent({
    workspaceId,
    entityType: "lead",
    action: "lead-ai-automation-start-failed",
    leadId: input.leadId
  });
}

export async function autoStartLeadAiAutomation(
  actor: AuthenticatedUser,
  leadId: string,
  options?: LeadAiAutomationOptions
): Promise<FollowUpSequenceDto | null> {
  const env = options?.env ?? process.env;
  if (!shouldAutoStartLeadAiAutomation(env)) return null;

  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: { automationOwnershipState: true }
  });
  if (lead?.automationOwnershipState !== "AI_ACTIVE") return null;

  try {
    const sequence = await startFollowUpSequence(
      actor,
      leadId,
      { idempotencyKey: `ai-autostart:follow-up:${leadId}:${options?.cycleKey ?? "initial"}` },
      { env, provider: options?.provider, now: options?.now }
    );

    if (sequence.status === "ATTENTION_REQUIRED") {
      await markLeadAutomationStartupFailure({
        leadId,
        code: sequence.lastErrorCode ?? "AI_LEAD_AUTOMATION_BLOCKED",
        message: sequence.lastErrorMessage ?? "AI lead automation needs review before it can start"
      });
      return sequence;
    }

    await prisma.auditEvent.create({
      data: {
        actorType: "SYSTEM",
        entityType: "Lead",
        entityId: leadId,
        action: "AI_LEAD_AUTOMATION_STARTED",
        after: {
          followUpSequenceId: sequence.id,
          status: sequence.status
        }
      }
    });
    return sequence;
  } catch (error) {
    await markLeadAutomationStartupFailure({
      leadId,
      code: error instanceof AppError ? error.code : "AI_LEAD_AUTOMATION_START_FAILED",
      message: error instanceof Error ? error.message : "AI lead automation could not start"
    });
    return null;
  }
}
