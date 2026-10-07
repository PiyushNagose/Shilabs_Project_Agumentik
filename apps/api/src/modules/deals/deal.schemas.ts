import { z } from "zod";
import { DEAL_STATUSES, PROPOSAL_STATUSES } from "@shilabs/shared-types";

const nullableTrimmedString = z
  .string()
  .trim()
  .transform((value) => (value.length > 0 ? value : null))
  .nullable()
  .optional();

const decimalString = z
  .union([z.string().trim().min(1), z.number().nonnegative()])
  .transform((value) => String(value));

export const dealStatusSchema = z.enum(DEAL_STATUSES);
export const proposalStatusSchema = z.enum(PROPOSAL_STATUSES);

export const createDealSchema = z.object({
  leadId: z.string().trim().min(1),
  stageId: z.string().trim().min(1).optional(),
  ownerId: z.string().trim().min(1).nullable().optional(),
  value: decimalString.nullable().optional(),
  currency: z.string().trim().length(3).default("INR"),
  probability: z.number().int().min(0).max(100).optional(),
  status: dealStatusSchema.optional(),
  proposalStatus: proposalStatusSchema.nullable().optional(),
  wonReason: nullableTrimmedString,
  lostReason: nullableTrimmedString,
  closeDate: z.iso.datetime().nullable().optional()
});

export const updateDealSchema = createDealSchema
  .omit({ leadId: true })
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field is required"
  });

export type CreateDealInput = z.infer<typeof createDealSchema>;
export type UpdateDealInput = z.infer<typeof updateDealSchema>;

export const listDealsQuerySchema = z.object({
  pipelineId: z.string().trim().min(1).optional(),
  stageId: z.string().trim().min(1).optional(),
  ownerId: z.string().trim().min(1).optional(),
  status: dealStatusSchema.optional(),
  search: z.string().trim().max(120).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50)
});
export type ListDealsQuery = z.infer<typeof listDealsQuerySchema>;
