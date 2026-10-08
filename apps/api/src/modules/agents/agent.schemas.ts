import { z } from "zod";
import { AGENT_STATUSES, AGENT_TYPES } from "@shilabs/shared-types";

const jsonRecord = z.record(z.string(), z.unknown());

export const createAgentSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().min(1).max(500),
  type: z.enum(AGENT_TYPES),
  definition: jsonRecord.default({}),
  modelConfig: jsonRecord.nullable().optional(),
  toolsConfig: jsonRecord.nullable().optional(),
  knowledgeConfig: jsonRecord.nullable().optional()
});

export const updateAgentSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    description: z.string().trim().min(1).max(500).optional(),
    definition: jsonRecord.optional(),
    modelConfig: jsonRecord.nullable().optional(),
    toolsConfig: jsonRecord.nullable().optional(),
    knowledgeConfig: jsonRecord.nullable().optional()
  })
  .refine((value) => Object.keys(value).length > 0, "At least one field is required");

export const updateAgentStatusSchema = z.object({
  status: z.enum(AGENT_STATUSES).refine((status) => status !== "DRAFT", "Use edit for drafts")
});

export const listAgentExecutionsQuerySchema = z.object({
  status: z.enum(["QUEUED", "RUNNING", "SUCCEEDED", "FAILED", "CANCELED"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50)
});

export type CreateAgentInput = z.infer<typeof createAgentSchema>;
export type UpdateAgentInput = z.infer<typeof updateAgentSchema>;
export type UpdateAgentStatusInput = z.infer<typeof updateAgentStatusSchema>;
export type ListAgentExecutionsQuery = z.infer<typeof listAgentExecutionsQuerySchema>;
