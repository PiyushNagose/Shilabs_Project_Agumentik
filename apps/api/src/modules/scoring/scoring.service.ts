import { Prisma } from "@prisma/client";
import type { LeadScoreOverrideDto, LeadScoreResultDto, ScoringConfigDto } from "@shilabs/shared-types";
import { AppError } from "../../shared/errors.js";
import type { AuthenticatedUser } from "../auth/auth.types.js";
import { calculateLeadScore, classifyScore } from "./scoring.engine.js";
import { scoringEvents } from "./scoring.events.js";
import type { OverrideLeadScoreInput, UpdateScoringConfigInput } from "./scoring.schemas.js";
import {
  createSkippedLeadScoreRun,
  findDefaultScoringConfig,
  findLeadWithQualification,
  getScoringConfigSnapshot,
  overrideLeadScoreWithActivityAndAudit,
  updateDefaultScoringConfigWithAudit,
  updateLeadScoreWithActivityAndAudit,
  type LeadWithQualificationRecord,
  type ScoringConfigRecord
} from "./scoring.repository.js";

export function toScoringConfigDto(config: ScoringConfigRecord): ScoringConfigDto {
  return {
    id: config.id,
    key: config.key,
    requirementWeight: config.requirementWeight,
    authorityWeight: config.authorityWeight,
    budgetWeight: config.budgetWeight,
    timelineWeight: config.timelineWeight,
    businessFitWeight: config.businessFitWeight,
    warmThreshold: config.warmThreshold,
    hotThreshold: config.hotThreshold,
    createdAt: config.createdAt.toISOString(),
    updatedAt: config.updatedAt.toISOString()
  };
}

function requireConfig(config: ScoringConfigRecord | null): ScoringConfigRecord {
  if (!config) throw new AppError(500, "INTERNAL_ERROR", "Default scoring config is missing");
  return config;
}

function requireLead(lead: LeadWithQualificationRecord | null): LeadWithQualificationRecord {
  if (!lead) throw new AppError(404, "NOT_FOUND", "Lead not found");
  return lead;
}

function validateConfigValues(
  config: Pick<
    ScoringConfigDto,
    | "requirementWeight"
    | "authorityWeight"
    | "budgetWeight"
    | "timelineWeight"
    | "businessFitWeight"
    | "warmThreshold"
    | "hotThreshold"
  >
): void {
  const totalWeight =
    config.requirementWeight +
    config.authorityWeight +
    config.budgetWeight +
    config.timelineWeight +
    config.businessFitWeight;
  if (totalWeight <= 0) {
    throw new AppError(
      400,
      "VALIDATION_ERROR",
      "At least one scoring factor weight must be positive"
    );
  }
  if (config.hotThreshold <= config.warmThreshold) {
    throw new AppError(
      400,
      "VALIDATION_ERROR",
      "Hot threshold must be greater than warm threshold"
    );
  }
}

function getQualificationSnapshot(
  lead: LeadWithQualificationRecord
): Prisma.InputJsonObject | null {
  if (!lead.qualification) return null;
  return {
    id: lead.qualification.id,
    leadId: lead.qualification.leadId,
    need: lead.qualification.need,
    requirement: lead.qualification.requirement,
    budget: lead.qualification.budget,
    budgetBand: lead.qualification.budgetBand,
    authority: lead.qualification.authority,
    timeline: lead.qualification.timeline,
    businessFit: lead.qualification.businessFit,
    decisionMakerIdentified: lead.qualification.decisionMakerIdentified,
    urgency: lead.qualification.urgency,
    evidence: lead.qualification.evidence.map((item) => ({
      messageId: item.messageId,
      quote: item.quote
    }))
  };
}

export async function getScoringConfig(): Promise<ScoringConfigDto> {
  return toScoringConfigDto(requireConfig(await findDefaultScoringConfig()));
}

export async function updateScoringConfig(
  actor: AuthenticatedUser,
  input: UpdateScoringConfigInput
): Promise<ScoringConfigDto> {
  const existing = requireConfig(await findDefaultScoringConfig());
  const merged = {
    ...toScoringConfigDto(existing),
    ...input
  };
  validateConfigValues(merged);
  const updated = await updateDefaultScoringConfigWithAudit({
    actorId: actor.id,
    action: scoringEvents.configUpdated,
    before: getScoringConfigSnapshot(existing),
    data: input
  });
  return toScoringConfigDto(updated);
}

export async function recalculateLeadScore(
  actor: AuthenticatedUser,
  leadId: string
): Promise<LeadScoreResultDto> {
  const [configRecord, lead] = await Promise.all([
    findDefaultScoringConfig(),
    findLeadWithQualification(leadId)
  ]);
  const existingConfig = requireConfig(configRecord);
  const config = toScoringConfigDto(existingConfig);
  const existingLead = requireLead(lead);
  const calculation = calculateLeadScore(existingLead.qualification, config);
  const qualificationSnapshot = getQualificationSnapshot(existingLead);
  const factorSnapshot: Prisma.InputJsonArray = calculation.factors.map((factor) => ({
    key: factor.key,
    label: factor.label,
    matched: factor.matched,
    weight: factor.weight,
    awarded: factor.awarded,
    reason: factor.reason
  }));
  if (existingLead.scoreOverrideAt) {
    const runId = await createSkippedLeadScoreRun({
      leadId: existingLead.id,
      actorId: actor.id,
      config: getScoringConfigSnapshot(existingConfig),
      qualificationSnapshot,
      reason: "Active human score override prevents automatic recalculation"
    });
    return {
      leadId: existingLead.id,
      score: existingLead.score,
      temperature: existingLead.temperature,
      factors: calculation.factors,
      config,
      persisted: false,
      skippedReason: "Active human score override prevents automatic recalculation",
      runId
    };
  }
  const updated = await updateLeadScoreWithActivityAndAudit({
    lead: existingLead,
    score: calculation.score,
    temperature: calculation.temperature,
    factors: factorSnapshot,
    config: getScoringConfigSnapshot(existingConfig),
    qualificationSnapshot,
    actorId: actor.id,
    action: scoringEvents.scoreChanged
  });
  return {
    leadId: updated.lead.id,
    score: updated.lead.score,
    temperature: updated.lead.temperature,
    factors: calculation.factors,
    config,
    persisted: true,
    skippedReason: null,
    runId: updated.runId
  };
}

export async function overrideLeadScore(
  actor: AuthenticatedUser,
  leadId: string,
  input: OverrideLeadScoreInput
): Promise<LeadScoreOverrideDto> {
  const [configRecord, lead] = await Promise.all([
    findDefaultScoringConfig(),
    findLeadWithQualification(leadId)
  ]);
  const existingConfig = requireConfig(configRecord);
  const config = toScoringConfigDto(existingConfig);
  const existingLead = requireLead(lead);
  const temperature = classifyScore(input.score, config);
  const result = await overrideLeadScoreWithActivityAndAudit({
    lead: existingLead,
    score: input.score,
    temperature,
    reason: input.reason,
    config: getScoringConfigSnapshot(existingConfig),
    actorId: actor.id
  });
  return {
    leadId: result.lead.id,
    score: result.lead.score,
    temperature: result.lead.temperature,
    reason: input.reason,
    overriddenAt: result.lead.scoreOverrideAt?.toISOString() ?? new Date().toISOString(),
    overriddenByUserId: actor.id,
    runId: result.runId
  };
}
