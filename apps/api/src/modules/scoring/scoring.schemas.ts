import { z } from "zod";

const weight = z.number().int().min(0).max(100);
const threshold = z.number().int().min(0).max(100);

export const updateScoringConfigSchema = z
  .strictObject({
    requirementWeight: weight.optional(),
    authorityWeight: weight.optional(),
    budgetWeight: weight.optional(),
    timelineWeight: weight.optional(),
    businessFitWeight: weight.optional(),
    warmThreshold: threshold.optional(),
    hotThreshold: threshold.optional()
  })
  .refine((input) => Object.keys(input).length > 0, "At least one scoring setting is required");

export type UpdateScoringConfigInput = z.infer<typeof updateScoringConfigSchema>;

export const overrideLeadScoreSchema = z.strictObject({
  score: z.number().int().min(0).max(100),
  reason: z.string().trim().min(3).max(500)
});

export type OverrideLeadScoreInput = z.infer<typeof overrideLeadScoreSchema>;
