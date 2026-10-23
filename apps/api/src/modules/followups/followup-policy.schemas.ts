import { z } from "zod";

const optionalSelector = z
  .string()
  .trim()
  .max(160)
  .transform((value) => (value.length > 0 ? value : null))
  .nullable()
  .optional();

const cadenceDays = z
  .array(z.number().int().min(0).max(365))
  .min(2)
  .max(12)
  .refine((days) => days[0] === 0, "Cadence must begin at day 0")
  .refine(
    (days) => days.every((day, index) => index === 0 || day > (days[index - 1] ?? -1)),
    "Cadence days must be unique and sorted ascending"
  );

const selectors = {
  companyId: optionalSelector,
  service: optionalSelector,
  leadType: optionalSelector,
  source: optionalSelector,
  country: optionalSelector,
  priority: optionalSelector,
  managerId: optionalSelector,
  campaign: optionalSelector,
  pipelineStageId: optionalSelector
};

const communicationPersonality = z
  .string()
  .trim()
  .max(2000)
  .transform((value) => value || null)
  .nullable()
  .optional();

export const createFollowUpPolicySchema = z.object({
  name: z.string().trim().min(1).max(120),
  enabled: z.boolean().default(true),
  isDefault: z.boolean().default(false),
  selectionPriority: z.number().int().min(-1000).max(1000).default(0),
  ...selectors,
  communicationPersonality,
  cadenceDays
});

export const updateFollowUpPolicySchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    enabled: z.boolean().optional(),
    isDefault: z.boolean().optional(),
    selectionPriority: z.number().int().min(-1000).max(1000).optional(),
    ...selectors,
    communicationPersonality,
    cadenceDays: cadenceDays.optional()
  })
  .refine((value) => Object.keys(value).length > 0, "At least one field is required");

export type CreateFollowUpPolicyInput = z.infer<typeof createFollowUpPolicySchema>;
export type UpdateFollowUpPolicyInput = z.infer<typeof updateFollowUpPolicySchema>;
