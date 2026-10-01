import { LeadTemperature, Prisma } from "@prisma/client";
import { prisma } from "../../shared/prisma.js";

const leadWithQualificationInclude = {
  qualification: {
    include: {
      evidence: true
    }
  }
} satisfies Prisma.LeadInclude;

export type ScoringConfigRecord = Prisma.ScoringConfigGetPayload<Record<string, never>>;
export type LeadWithQualificationRecord = Prisma.LeadGetPayload<{
  include: typeof leadWithQualificationInclude;
}>;

export async function findDefaultScoringConfig(): Promise<ScoringConfigRecord | null> {
  return prisma.scoringConfig.findUnique({ where: { key: "default" } });
}

export async function updateDefaultScoringConfigWithAudit(input: {
  data: Prisma.ScoringConfigUpdateInput;
  actorId: string;
  before: Prisma.InputJsonValue;
  action: string;
}): Promise<ScoringConfigRecord> {
  return prisma.$transaction(
    async (transaction) => {
      const config = await transaction.scoringConfig.update({
        where: { key: "default" },
        data: input.data
      });
      await transaction.auditEvent.create({
        data: {
          actorType: "USER",
          actorId: input.actorId,
          entityType: "ScoringConfig",
          entityId: config.id,
          action: input.action,
          before: input.before,
          after: getScoringConfigSnapshot(config)
        }
      });
      return config;
    },
    { maxWait: 10000, timeout: 30000 }
  );
}

export async function findLeadWithQualification(
  leadId: string
): Promise<LeadWithQualificationRecord | null> {
  return prisma.lead.findUnique({
    where: { id: leadId },
    include: leadWithQualificationInclude
  });
}

export async function updateLeadScoreWithActivityAndAudit(input: {
  lead: LeadWithQualificationRecord;
  score: number;
  temperature: LeadTemperature;
  factors: Prisma.InputJsonArray;
  config: Prisma.InputJsonObject;
  qualificationSnapshot: Prisma.InputJsonObject | null;
  actor: { type: "USER" | "SYSTEM"; id: string | null };
  action: string;
}): Promise<{ lead: LeadWithQualificationRecord; runId: string }> {
  return prisma.$transaction(
    async (transaction) => {
      const updated = await transaction.lead.update({
        where: { id: input.lead.id },
        data: {
          score: input.score,
          temperature: input.temperature,
          scoreOverrideAt: null,
          scoreOverrideByUserId: null,
          scoreOverrideReason: null,
          lastActivityAt: new Date()
        },
        include: leadWithQualificationInclude
      });
      const run = await transaction.leadScoreRun.create({
        data: {
          leadId: input.lead.id,
          actorUserId: input.actor.id,
          source: "RULE_ENGINE",
          status: "COMPLETED",
          score: input.score,
          temperature: input.temperature,
          factors: input.factors,
          config: input.config,
          qualificationSnapshot: input.qualificationSnapshot ?? Prisma.JsonNull
        }
      });
      await transaction.activity.create({
        data: {
          leadId: input.lead.id,
          actorUserId: input.actor.id,
          type: "SCORE_CHANGED",
          description: `Lead score recalculated from ${String(input.lead.score)} to ${String(input.score)}`
        }
      });
      await transaction.auditEvent.create({
        data: {
          actorType: input.actor.type,
          actorId: input.actor.id,
          entityType: "Lead",
          entityId: input.lead.id,
          action: input.action,
          before: {
            id: input.lead.id,
            score: input.lead.score,
            temperature: input.lead.temperature
          },
          after: {
            id: updated.id,
            score: updated.score,
            temperature: updated.temperature,
            factors: input.factors,
            config: input.config,
            scoreRunId: run.id
          }
        }
      });
      return { lead: updated, runId: run.id };
    },
    { maxWait: 10000, timeout: 30000 }
  );
}

export async function createSkippedLeadScoreRun(input: {
  leadId: string;
  actorId: string | null;
  config: Prisma.InputJsonObject;
  qualificationSnapshot: Prisma.InputJsonObject | null;
  reason: string;
}): Promise<string> {
  const run = await prisma.leadScoreRun.create({
    data: {
      leadId: input.leadId,
      actorUserId: input.actorId,
      source: "RULE_ENGINE",
      status: "SKIPPED",
      config: input.config,
      qualificationSnapshot: input.qualificationSnapshot ?? Prisma.JsonNull,
      reason: input.reason
    }
  });
  return run.id;
}

export async function overrideLeadScoreWithActivityAndAudit(input: {
  lead: LeadWithQualificationRecord;
  score: number;
  temperature: LeadTemperature;
  reason: string;
  config: Prisma.InputJsonObject;
  actorId: string;
}): Promise<{ lead: LeadWithQualificationRecord; runId: string }> {
  return prisma.$transaction(
    async (transaction) => {
      const now = new Date();
      const updated = await transaction.lead.update({
        where: { id: input.lead.id },
        data: {
          score: input.score,
          temperature: input.temperature,
          scoreOverrideAt: now,
          scoreOverrideByUserId: input.actorId,
          scoreOverrideReason: input.reason,
          lastActivityAt: now
        },
        include: leadWithQualificationInclude
      });
      const run = await transaction.leadScoreRun.create({
        data: {
          leadId: input.lead.id,
          actorUserId: input.actorId,
          source: "MANUAL_OVERRIDE",
          status: "COMPLETED",
          score: input.score,
          temperature: input.temperature,
          config: input.config,
          reason: input.reason
        }
      });
      await transaction.activity.create({
        data: {
          leadId: input.lead.id,
          actorUserId: input.actorId,
          type: "SCORE_CHANGED",
          description: `Lead score manually overridden from ${String(input.lead.score)} to ${String(input.score)}`
        }
      });
      await transaction.auditEvent.create({
        data: {
          actorType: "USER",
          actorId: input.actorId,
          entityType: "Lead",
          entityId: input.lead.id,
          action: "LEAD_SCORE_OVERRIDDEN",
          before: {
            id: input.lead.id,
            score: input.lead.score,
            temperature: input.lead.temperature,
            scoreOverrideAt: input.lead.scoreOverrideAt,
            scoreOverrideReason: input.lead.scoreOverrideReason
          },
          after: {
            id: updated.id,
            score: updated.score,
            temperature: updated.temperature,
            scoreOverrideAt: updated.scoreOverrideAt,
            scoreOverrideReason: updated.scoreOverrideReason,
            scoreRunId: run.id
          }
        }
      });
      return { lead: updated, runId: run.id };
    },
    { maxWait: 10000, timeout: 30000 }
  );
}

export function getScoringConfigSnapshot(config: ScoringConfigRecord): Prisma.InputJsonObject {
  return {
    id: config.id,
    key: config.key,
    requirementWeight: config.requirementWeight,
    authorityWeight: config.authorityWeight,
    budgetWeight: config.budgetWeight,
    timelineWeight: config.timelineWeight,
    businessFitWeight: config.businessFitWeight,
    warmThreshold: config.warmThreshold,
    hotThreshold: config.hotThreshold
  };
}
