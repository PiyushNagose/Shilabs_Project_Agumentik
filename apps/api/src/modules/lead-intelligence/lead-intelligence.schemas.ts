import { z } from "zod";
import {
  LEAD_AI_CONTROL_STATUSES,
  LEAD_DOCUMENT_KINDS,
  LEAD_FOLLOW_UP_MODES,
  LEAD_PREFERRED_CHANNELS
} from "@shilabs/shared-types";

export const updateLeadIntelligenceControlsSchema = z
  .object({
    aiControlStatus: z.enum(LEAD_AI_CONTROL_STATUSES).optional(),
    followUpMode: z.enum(LEAD_FOLLOW_UP_MODES).optional(),
    humanInterventionRequired: z.boolean().optional(),
    preferredChannel: z.enum(LEAD_PREFERRED_CHANNELS).optional(),
    customCadenceDays: z.array(z.number().int().min(1).max(365)).max(20).optional()
  })
  .refine((value) => Object.keys(value).length > 0, "At least one control must be provided");

export const createLeadDocumentSchema = z
  .object({
    title: z.string().trim().min(1).max(180),
    kind: z.enum(LEAD_DOCUMENT_KINDS),
    sourceType: z.enum(["UPLOAD", "LINK", "CRM"]),
    sourceUrl: z.url().max(2000).optional(),
    mimeType: z.string().trim().max(120).optional(),
    content: z.string().trim().max(250_000).optional()
  })
  .superRefine((value, context) => {
    if (value.sourceType === "LINK" && !value.sourceUrl) {
      context.addIssue({
        code: "custom",
        path: ["sourceUrl"],
        message: "Linked documents require a source URL"
      });
    }
  });

export type UpdateLeadIntelligenceControlsInput = z.infer<
  typeof updateLeadIntelligenceControlsSchema
>;
export type CreateLeadDocumentInput = z.infer<typeof createLeadDocumentSchema>;
