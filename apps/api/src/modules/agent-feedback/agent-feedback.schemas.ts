import { z } from "zod";
import { AGENT_CORRECTION_SOURCE_TYPES } from "@shilabs/shared-types";

export const correctionSourceTypeSchema = z.enum(AGENT_CORRECTION_SOURCE_TYPES);

export const createAgentCorrectionSchema = z.object({
  sourceEntityType: correctionSourceTypeSchema,
  sourceEntityId: z.string().trim().min(1),
  correctedOutcome: z.unknown(),
  correctionSummary: z.string().trim().min(3).max(2000),
  supersedesCorrectionId: z.string().trim().min(1).optional()
});

export const createProposalCorrectionSchema = z.object({
  correctedOutcome: z.unknown(),
  correctionSummary: z.string().trim().min(3).max(2000),
  supersedesCorrectionId: z.string().trim().min(1).optional()
});

export const listAgentCorrectionsQuerySchema = z.object({
  sourceEntityType: correctionSourceTypeSchema.optional(),
  sourceEntityId: z.string().trim().min(1).optional(),
  leadId: z.string().trim().min(1).optional(),
  proposalId: z.string().trim().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50)
});

export type CreateAgentCorrectionInput = z.infer<typeof createAgentCorrectionSchema>;
export type CreateProposalCorrectionInput = z.infer<typeof createProposalCorrectionSchema>;
export type ListAgentCorrectionsQuery = z.infer<typeof listAgentCorrectionsQuerySchema>;
