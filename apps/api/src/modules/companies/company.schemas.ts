import { z } from "zod";

const nullableTrimmedString = z
  .string()
  .trim()
  .transform((value) => (value.length > 0 ? value : null))
  .nullable()
  .optional();

export const createCompanySchema = z.object({
  name: z.string().trim().min(1).max(160),
  website: nullableTrimmedString,
  industry: nullableTrimmedString,
  location: nullableTrimmedString,
  employeeRange: nullableTrimmedString,
  notes: nullableTrimmedString
});

export const updateCompanySchema = createCompanySchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field is required"
  });

export type CreateCompanyInput = z.infer<typeof createCompanySchema>;
export type UpdateCompanyInput = z.infer<typeof updateCompanySchema>;
