import type {
  LeadScoreFactorDto,
  LeadTemperatureName,
  ScoringConfigDto
} from "@shilabs/shared-types";

export interface ScoringQualificationInput {
  need: string | null;
  requirement: string | null;
  budget: string | null;
  budgetBand: string | null;
  authority: string | null;
  timeline: string | null;
  businessFit: string | null;
  decisionMakerIdentified: boolean | null;
}

export interface ScoreCalculation {
  score: number;
  temperature: LeadTemperatureName;
  factors: LeadScoreFactorDto[];
}

function hasText(value: string | null | undefined): boolean {
  return Boolean(value?.trim());
}

function isNegativeFit(value: string | null): boolean {
  return /\b(no fit|not a fit|poor fit|bad fit|weak fit|low fit|not suitable|not relevant)\b/i.test(
    value ?? ""
  );
}

export function classifyScore(
  score: number,
  config: Pick<ScoringConfigDto, "hotThreshold" | "warmThreshold">
): LeadTemperatureName {
  if (score >= config.hotThreshold) return "HOT";
  if (score >= config.warmThreshold) return "WARM";
  return "NURTURE";
}

export function calculateLeadScore(
  qualification: ScoringQualificationInput | null,
  config: ScoringConfigDto
): ScoreCalculation {
  const hasRequirement = hasText(qualification?.requirement) || hasText(qualification?.need);
  const hasAuthority =
    qualification?.decisionMakerIdentified === true || hasText(qualification?.authority);
  const hasBudget = hasText(qualification?.budget) || hasText(qualification?.budgetBand);
  const hasTimeline = hasText(qualification?.timeline);
  const hasBusinessFit =
    hasText(qualification?.businessFit) && !isNegativeFit(qualification?.businessFit ?? null);
  const factors: LeadScoreFactorDto[] = [
    {
      key: "REQUIREMENT",
      label: "Clear requirement",
      matched: hasRequirement,
      weight: config.requirementWeight,
      awarded: hasRequirement ? config.requirementWeight : 0,
      reason: hasRequirement ? "Requirement or need is present" : "Requirement and need are unknown"
    },
    {
      key: "AUTHORITY",
      label: "Decision authority",
      matched: hasAuthority,
      weight: config.authorityWeight,
      awarded: hasAuthority ? config.authorityWeight : 0,
      reason: hasAuthority ? "Authority signal is present" : "Decision authority is unknown"
    },
    {
      key: "BUDGET",
      label: "Budget identified",
      matched: hasBudget,
      weight: config.budgetWeight,
      awarded: hasBudget ? config.budgetWeight : 0,
      reason: hasBudget ? "Budget or budget band is present" : "Budget is unknown"
    },
    {
      key: "TIMELINE",
      label: "Timeline identified",
      matched: hasTimeline,
      weight: config.timelineWeight,
      awarded: hasTimeline ? config.timelineWeight : 0,
      reason: hasTimeline ? "Timeline is present" : "Timeline is unknown"
    },
    {
      key: "BUSINESS_FIT",
      label: "Strong business fit",
      matched: hasBusinessFit,
      weight: config.businessFitWeight,
      awarded: hasBusinessFit ? config.businessFitWeight : 0,
      reason: hasBusinessFit ? "Business fit is present" : "Business fit is unknown or weak"
    }
  ];
  const score = Math.min(
    100,
    Math.max(
      0,
      factors.reduce((total, factor) => total + factor.awarded, 0)
    )
  );
  return {
    score,
    temperature: classifyScore(score, config),
    factors
  };
}
