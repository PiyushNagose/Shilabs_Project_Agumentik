import { z } from "zod";

export const createPipelineSchema = z.object({
  name: z.string().trim().min(1).max(120),
  type: z.string().trim().min(1).max(40).default("SALES"),
  isDefault: z.boolean().optional()
});
export const updatePipelineSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  status: z.enum(["ACTIVE", "ARCHIVED"]).optional()
}).refine((value) => Object.keys(value).length > 0, "At least one field is required");
export const createPipelineStageSchema = z.object({
  name: z.string().trim().min(1).max(100),
  probability: z.number().int().min(0).max(100).default(0),
  color: z.string().trim().max(32).nullable().optional(),
  isWon: z.boolean().default(false),
  isLost: z.boolean().default(false)
}).refine((value) => !(value.isWon && value.isLost), "A stage cannot be both won and lost");
export const updatePipelineStageSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  probability: z.number().int().min(0).max(100).optional(),
  color: z.string().trim().max(32).nullable().optional(),
  status: z.enum(["ACTIVE", "ARCHIVED"]).optional()
}).refine((value) => Object.keys(value).length > 0, "At least one field is required");
export const reorderPipelineStagesSchema = z.object({
  stageIds: z.array(z.string().trim().min(1)).min(1).refine((ids) => new Set(ids).size === ids.length, "stageIds must be unique")
});

export type CreatePipelineInput = z.infer<typeof createPipelineSchema>;
export type UpdatePipelineInput = z.infer<typeof updatePipelineSchema>;
export type CreatePipelineStageInput = z.infer<typeof createPipelineStageSchema>;
export type UpdatePipelineStageInput = z.infer<typeof updatePipelineStageSchema>;
export type ReorderPipelineStagesInput = z.infer<typeof reorderPipelineStagesSchema>;
