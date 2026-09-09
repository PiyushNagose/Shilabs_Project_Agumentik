import { z } from "zod";
import { LEAD_STATUSES, LEAD_TEMPERATURES } from "@shilabs/shared-types";

const nullableTrimmedString = z
  .string()
  .trim()
  .transform((value) => (value.length > 0 ? value : null))
  .nullable()
  .optional();

const dateTimeString = z.iso.datetime({ offset: true });

const decimalString = z
  .union([z.string().trim().min(1), z.number().nonnegative()])
  .transform((value) => String(value));

export const leadStatusSchema = z.enum(LEAD_STATUSES);
export const leadTemperatureSchema = z.enum(LEAD_TEMPERATURES);

export const createLeadSchema = z.object({
  companyId: z.string().trim().min(1),
  contactId: z.string().trim().min(1),
  ownerId: z.string().trim().min(1).nullable().optional(),
  source: z.string().trim().min(1).max(120),
  requirement: nullableTrimmedString,
  serviceInterest: nullableTrimmedString,
  estimatedValue: decimalString.nullable().optional(),
  currency: z.string().trim().length(3).default("INR"),
  nextAction: nullableTrimmedString,
  nextActionAt: dateTimeString.nullable().optional()
});

export const updateLeadSchema = z
  .object({
    source: z.string().trim().min(1).max(120).optional(),
    requirement: nullableTrimmedString,
    serviceInterest: nullableTrimmedString,
    estimatedValue: decimalString.nullable().optional(),
    currency: z.string().trim().length(3).optional(),
    nextAction: nullableTrimmedString,
    nextActionAt: dateTimeString.nullable().optional()
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field is required"
  });

export const assignLeadSchema = z.object({
  ownerId: z.string().trim().min(1).nullable()
});

export const updateLeadStatusSchema = z.object({
  status: leadStatusSchema
});

export const listLeadsQuerySchema = z
  .object({
    page: z.coerce.number().int().positive().optional(),
    pageSize: z.coerce.number().int().positive().max(100).optional(),
    search: z.string().trim().min(1).optional(),
    source: z.string().trim().min(1).optional(),
    status: leadStatusSchema.optional(),
    stageId: z.string().trim().min(1).optional(),
    ownerId: z.string().trim().min(1).optional(),
    scoreMin: z.coerce.number().int().min(0).max(100).optional(),
    scoreMax: z.coerce.number().int().min(0).max(100).optional(),
    temperature: leadTemperatureSchema.optional(),
    sort: z.enum(["createdAt", "lastActivityAt"]).default("createdAt"),
    direction: z.enum(["asc", "desc"]).default("desc")
  })
  .refine(
    (value) =>
      value.scoreMin === undefined ||
      value.scoreMax === undefined ||
      value.scoreMin <= value.scoreMax,
    {
      message: "scoreMin must be less than or equal to scoreMax"
    }
  );

export type CreateLeadInput = z.infer<typeof createLeadSchema>;
export type UpdateLeadInput = z.infer<typeof updateLeadSchema>;
export type AssignLeadInput = z.infer<typeof assignLeadSchema>;
export type UpdateLeadStatusInput = z.infer<typeof updateLeadStatusSchema>;
export type ListLeadsQuery = z.infer<typeof listLeadsQuerySchema>;
