import type { FollowUpSequenceDto } from "@shilabs/shared-types";
import { AppError } from "../../shared/errors.js";
import { prisma } from "../../shared/prisma.js";
import type { AIProvider } from "../ai/ai.provider.js";
import type { AuthenticatedUser } from "../auth/auth.types.js";
import { publishRealtimeEvent } from "../realtime/realtime.service.js";
import { startFollowUpSequence } from "./followup.service.js";

export interface LeadAiAutomationOptions {
  env?: NodeJS.ProcessEnv;
  provider?: AIProvider;
  now?: Date;
}

function envFlagEnabled(value: string | undefined): boolean | null {
  if (value === undefined) return null;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return null;
}

export function shouldAutoStartLeadAiAutomation(env: NodeJS.ProcessEnv = process.env): boolean {
  if (
    (env.NODE_ENV === "test" || env.VITEST === "true") &&
    env.AI_AUTOSTART_ON_LEAD_CREATE_IN_TEST !== "true"
  ) {
    return false;
  }
  const explicit = envFlagEnabled(env.AI_AUTOSTART_ON_LEAD_CREATE);
  if (explicit !== null) return explicit;
  return true;
}

async function markLeadAutomationStartupFailure(input: {
  leadId: string;
  code: string;
  message: string;
}): Promise<void> {
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.lead.update({
      where: { id: input.leadId },
      data: {
        nextAction: "Review AI automation startup",
        nextActionAt: now,
        lastActivityAt: now
      }
    });
    await tx.activity.create({
      data: {
        leadId: input.leadId,
        type: "MESSAGE_RECEIVED",
        description: `AI lead automation startup failed: ${input.message}`
      }
    });
    await tx.auditEvent.create({
      data: {
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
  });
  await publishRealtimeEvent({
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

  try {
    const sequence = await startFollowUpSequence(
      actor,
      leadId,
      { idempotencyKey: `ai-autostart:follow-up:${leadId}` },
      { env, provider: options?.provider, now: options?.now }
    );

    if (sequence.status === "ATTENTION_REQUIRED") {
      await markLeadAutomationStartupFailure({
        leadId,
        code: sequence.lastErrorCode ?? "AI_LEAD_AUTOMATION_BLOCKED",
        message: sequence.lastErrorMessage ?? "AI lead automation needs review before it can start"
      });
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
