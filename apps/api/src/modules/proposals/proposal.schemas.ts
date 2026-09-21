import { z } from "zod";
import { PROPOSAL_WORKFLOW_STATUSES } from "@shilabs/shared-types";

const cuidSchema = z.string().min(1);
const optionalTextSchema = z.string().trim().min(1).max(500).optional();

export const listProposalsQuerySchema = z.object({
  leadId: cuidSchema.optional(),
  dealId: cuidSchema.optional(),
  status: z.enum(PROPOSAL_WORKFLOW_STATUSES).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50)
});

export type ListProposalsQuery = z.infer<typeof listProposalsQuerySchema>;

export const createProposalSchema = z.object({
  leadId: cuidSchema,
  dealId: cuidSchema.optional(),
  title: z.string().trim().min(1).max(200),
  serviceType: z.string().trim().min(1).max(100).optional(),
  content: z.string().trim().min(1).max(50000),
  editSummary: optionalTextSchema,
  idempotencyKey: z.string().trim().min(1).max(200).optional()
});

export type CreateProposalInput = z.infer<typeof createProposalSchema>;

export const updateProposalDraftSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  serviceType: z.string().trim().min(1).max(100).nullable().optional(),
  content: z.string().trim().min(1).max(50000),
  editSummary: optionalTextSchema
});

export type UpdateProposalDraftInput = z.infer<typeof updateProposalDraftSchema>;

export const submitProposalForApprovalSchema = z.object({
  reason: optionalTextSchema
});

export type SubmitProposalForApprovalInput = z.infer<typeof submitProposalForApprovalSchema>;

export const approveProposalSchema = z.object({
  reason: optionalTextSchema
});

export type ApproveProposalInput = z.infer<typeof approveProposalSchema>;

export const recordProposalSentSchema = z.object({
  outboundEmailId: cuidSchema,
  reason: optionalTextSchema
});

export type RecordProposalSentInput = z.infer<typeof recordProposalSentSchema>;

export const sendApprovedProposalSchema = z.object({
  subject: z.string().trim().min(1).max(500).optional(),
  idempotencyKey: z.string().trim().min(8).max(200).optional()
});

export type SendApprovedProposalInput = z.infer<typeof sendApprovedProposalSchema>;
