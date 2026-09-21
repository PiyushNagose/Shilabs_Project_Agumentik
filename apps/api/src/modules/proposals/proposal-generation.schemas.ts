import { z } from "zod";
import { PROPOSAL_GENERATION_KINDS } from "@shilabs/shared-types";

const idSchema = z.string().trim().min(1);
const optionalText = z.string().trim().min(1).max(1000).optional();

export const generateProposalSchema = z.object({
  leadId: idSchema,
  dealId: idSchema.optional(),
  kind: z.enum(PROPOSAL_GENERATION_KINDS),
  targetWebsite: z.string().trim().min(1).max(500).optional(),
  brandName: optionalText,
  brandGuidelines: z.string().trim().min(1).max(4000).optional(),
  designGoals: z.string().trim().min(1).max(4000).optional(),
  preferredStyle: optionalText,
  requiredPages: z.array(z.string().trim().min(1).max(100)).max(50).optional(),
  additionalContext: z.string().trim().min(1).max(6000).optional(),
  idempotencyKey: z.string().trim().min(1).max(200).optional()
});

export type GenerateProposalInput = z.infer<typeof generateProposalSchema>;
