import { z } from "zod";

const nullableTrimmedString = z
  .string()
  .trim()
  .transform((value) => (value.length > 0 ? value : null))
  .nullable()
  .optional();

export const createContactSchema = z.object({
  companyId: z.string().trim().min(1),
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  title: nullableTrimmedString,
  email: z.string().trim().pipe(z.email()).nullable().optional(),
  phone: nullableTrimmedString,
  whatsappId: nullableTrimmedString,
  source: nullableTrimmedString,
  preferredChannel: nullableTrimmedString,
  doNotContact: z.boolean().optional()
});

export const updateContactSchema = createContactSchema
  .omit({ companyId: true })
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field is required"
  });

export type CreateContactInput = z.infer<typeof createContactSchema>;
export type UpdateContactInput = z.infer<typeof updateContactSchema>;
