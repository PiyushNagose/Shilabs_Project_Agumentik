import { z } from "zod";
import { WORKFLOW_DECISIONS, WORKFLOW_NODE_TYPES, WORKFLOW_STATUSES } from "@shilabs/shared-types";

const jsonRecord = z.record(z.string(), z.unknown());
const node = z.object({
  id: z.string().trim().min(1).max(80),
  type: z.enum(WORKFLOW_NODE_TYPES),
  label: z.string().trim().min(1).max(120),
  position: z.object({ x: z.number().min(0).max(5000), y: z.number().min(0).max(5000) }),
  config: jsonRecord.default({})
});
const edge = z.object({
  id: z.string().trim().min(1).max(80),
  source: z.string().trim().min(1).max(80),
  target: z.string().trim().min(1).max(80),
  branch: z.string().trim().min(1).max(80).nullable().default(null)
});
export const workflowDefinitionSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal("WORKFLOW"),
  nodes: z.array(node).min(1).max(150),
  edges: z.array(edge).max(400)
});
export const workflowPolicySchema = z
  .object({
    service: z.string().trim().max(120).optional(),
    leadType: z.string().trim().max(120).optional(),
    source: z.string().trim().max(120).optional(),
    country: z.string().trim().max(120).optional(),
    priority: z.string().trim().max(40).optional(),
    managerId: z.string().trim().max(120).optional(),
    campaign: z.string().trim().max(120).optional(),
    pipelineStageId: z.string().trim().max(120).optional(),
    cadenceMinutes: z.array(z.number().int().min(1).max(525600)).max(50).optional()
  })
  .strict();
export const createWorkflowSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().min(1).max(500),
  definition: workflowDefinitionSchema.optional(),
  policyConfig: workflowPolicySchema.optional()
});
export const updateWorkflowSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    description: z.string().trim().min(1).max(500).optional()
  })
  .refine((value) => Object.keys(value).length > 0, "At least one field is required");
export const saveWorkflowDraftSchema = z.object({
  definition: workflowDefinitionSchema,
  policyConfig: workflowPolicySchema.optional()
});
export const previewWorkflowSchema = z.object({ definition: workflowDefinitionSchema.optional() });
export const updateWorkflowStatusSchema = z.object({
  status: z
    .enum(WORKFLOW_STATUSES)
    .refine((value) => value === "PAUSED" || value === "PUBLISHED" || value === "ARCHIVED")
});
export const executeWorkflowSchema = z.object({
  leadId: z.string().trim().min(1),
  source: z.string().trim().min(1).max(80).default("MANUAL"),
  sourceEntityType: z.string().trim().max(80).optional(),
  sourceEntityId: z.string().trim().max(120).optional(),
  idempotencyKey: z.string().trim().min(8).max(200).optional(),
  input: jsonRecord.optional()
});
export const decisionSchema = z.enum(WORKFLOW_DECISIONS);

export type WorkflowDefinitionInput = z.infer<typeof workflowDefinitionSchema>;
export type WorkflowPolicyInput = z.infer<typeof workflowPolicySchema>;
export type CreateWorkflowInput = z.infer<typeof createWorkflowSchema>;
export type UpdateWorkflowInput = z.infer<typeof updateWorkflowSchema>;
export type SaveWorkflowDraftInput = z.infer<typeof saveWorkflowDraftSchema>;
export type PreviewWorkflowInput = z.infer<typeof previewWorkflowSchema>;
export type UpdateWorkflowStatusInput = z.infer<typeof updateWorkflowStatusSchema>;
export type ExecuteWorkflowInput = z.infer<typeof executeWorkflowSchema>;
