import { z } from "zod";
import { AGENT_COMPOSER_NODE_TYPES, AGENT_STATUSES, AGENT_TYPES } from "@shilabs/shared-types";

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

const composerNodeSchema = z.object({
  id: z.string().trim().min(1).max(80),
  type: z.enum(AGENT_COMPOSER_NODE_TYPES),
  label: z.string().trim().min(1).max(120),
  position: z.object({
    x: z.number().min(0).max(5000),
    y: z.number().min(0).max(5000)
  }),
  config: jsonRecord.default({})
});

const composerEdgeSchema = z.object({
  id: z.string().trim().min(1).max(80),
  source: z.string().trim().min(1).max(80),
  target: z.string().trim().min(1).max(80),
  branch: z.string().trim().min(1).max(80).nullable().default(null)
});

export const composerDefinitionSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal("AGENT_COMPOSER"),
  nodes: z.array(composerNodeSchema).min(1).max(100),
  edges: z.array(composerEdgeSchema).max(250)
});

export const saveAgentComposerSchema = z.object({ definition: composerDefinitionSchema });
export const previewAgentComposerSchema = z.object({
  definition: composerDefinitionSchema.optional()
});

export type CreateAgentInput = z.infer<typeof createAgentSchema>;
export type UpdateAgentInput = z.infer<typeof updateAgentSchema>;
export type UpdateAgentStatusInput = z.infer<typeof updateAgentStatusSchema>;
export type ListAgentExecutionsQuery = z.infer<typeof listAgentExecutionsQuerySchema>;
export type ComposerDefinitionInput = z.infer<typeof composerDefinitionSchema>;
export type SaveAgentComposerInput = z.infer<typeof saveAgentComposerSchema>;
export type PreviewAgentComposerInput = z.infer<typeof previewAgentComposerSchema>;
