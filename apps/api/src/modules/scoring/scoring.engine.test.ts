import { describe, expect, it } from "vitest";
import type { ScoringConfigDto } from "@shilabs/shared-types";
import {
  calculateLeadScore,
  classifyScore,
  type ScoringQualificationInput
} from "./scoring.engine.js";

const config: ScoringConfigDto = {
  id: "default-scoring-config",
  key: "default",
  requirementWeight: 20,
  authorityWeight: 20,
  budgetWeight: 20,
  timelineWeight: 20,
  businessFitWeight: 20,
  warmThreshold: 60,
  hotThreshold: 80,
  createdAt: "2026-09-10T00:00:00.000Z",
  updatedAt: "2026-09-10T00:00:00.000Z"
};

const emptyQualification: ScoringQualificationInput = {
  need: null,
  requirement: null,
  budget: null,
  budgetBand: null,
  authority: null,
  timeline: null,
  businessFit: null,
  decisionMakerIdentified: null
};

describe("M11 scoring engine", () => {
  it.each([
    ["REQUIREMENT", { requirement: "Needs ecommerce build" }, 20],
    ["REQUIREMENT", { need: "Website redesign" }, 20],
    ["AUTHORITY", { authority: "Founder" }, 20],
    ["AUTHORITY", { decisionMakerIdentified: true }, 20],
    ["BUDGET", { budget: "5000 USD" }, 20],
    ["BUDGET", { budgetBand: "5k-10k" }, 20],
    ["TIMELINE", { timeline: "this month" }, 20],
    ["BUSINESS_FIT", { businessFit: "Strong fit for web development" }, 20]
  ] as const)("awards deterministic points for %s", (_factor, partial, expected) => {
    const result = calculateLeadScore({ ...emptyQualification, ...partial }, config);
    expect(result.score).toBe(expected);
    expect(result.temperature).toBe("NURTURE");
  });

  it("caps total score at 100 and classifies hot leads", () => {
    const result = calculateLeadScore(
      {
        need: "Website",
        requirement: "Real estate website",
        budget: "10000 USD",
        budgetBand: null,
        authority: "Owner",
        timeline: "ASAP",
        businessFit: "Strong fit",
        decisionMakerIdentified: true
      },
      {
        ...config,
        requirementWeight: 30,
        authorityWeight: 30,
        budgetWeight: 30,
        timelineWeight: 30
      }
    );
    expect(result.score).toBe(100);
    expect(result.temperature).toBe("HOT");
  });

  it("does not award business-fit points for weak fit text", () => {
    const result = calculateLeadScore({ ...emptyQualification, businessFit: "poor fit" }, config);
    expect(result.score).toBe(0);
    expect(result.factors.find((factor) => factor.key === "BUSINESS_FIT")?.matched).toBe(false);
  });

  it.each([
    [59, "NURTURE"],
    [60, "WARM"],
    [79, "WARM"],
    [80, "HOT"]
  ] as const)("classifies exact boundary score %i as %s", (score, temperature) => {
    expect(classifyScore(score, config)).toBe(temperature);
  });
});
