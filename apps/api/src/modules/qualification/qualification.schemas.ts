import { z } from "zod";

const nullableText = z.string().trim().min(1).max(12000).nullable();
const optionalNullableText = z.string().trim().min(1).max(12000).nullable().optional();

export const qualificationEvidenceSchema = z.strictObject({
  messageId: z.string().trim().min(1),
  quote: z.string().trim().min(1).max(12000)
});

export const updateQualificationSchema = z
  .strictObject({
    need: optionalNullableText,
    requirement: optionalNullableText,
    budget: optionalNullableText,
    budgetBand: optionalNullableText,
    authority: optionalNullableText,
    timeline: optionalNullableText,
    businessFit: optionalNullableText,
    decisionMakerIdentified: z.boolean().nullable().optional(),
    urgency: optionalNullableText,
    evidence: z.array(qualificationEvidenceSchema).max(100).optional()
  })
  .refine((input) => Object.keys(input).length > 0, "At least one qualification field is required");

export const qualificationResultWithNullsSchema = z.strictObject({
  need: nullableText,
  requirement: nullableText,
  budget: nullableText,
  budgetBand: nullableText,
  authority: nullableText,
  timeline: nullableText,
  businessFit: nullableText,
  decisionMakerIdentified: z.boolean().nullable(),
  urgency: nullableText,
  evidence: z.array(qualificationEvidenceSchema).max(100)
});

export type UpdateQualificationInput = z.infer<typeof updateQualificationSchema>;
export type QualificationResultWithNulls = z.infer<typeof qualificationResultWithNullsSchema>;
