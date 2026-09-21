import { z } from "zod";

const optionalEmailBodySchema = z.string().trim().min(1).max(20000).optional();
const emailAddressSchema = z
  .email()
  .trim()
  .toLowerCase()
  .max(320);

export const sendEmailSchema = z
  .object({
    leadId: z.string().min(1),
    subject: z.string().trim().min(1).max(500),
    textBody: optionalEmailBodySchema,
    htmlBody: optionalEmailBodySchema,
    idempotencyKey: z.string().trim().min(8).max(200)
  })
  .refine((value) => Boolean(value.textBody ?? value.htmlBody), {
    message: "Either textBody or htmlBody is required",
    path: ["textBody"]
  });

export type SendEmailInput = z.infer<typeof sendEmailSchema>;

export const validatePreSendEmailSchema = z.object({
  leadId: z.string().min(1)
});

export type ValidatePreSendEmailInput = z.infer<typeof validatePreSendEmailSchema>;

export const createEmailSuppressionSchema = z.object({
  email: emailAddressSchema,
  reason: z.enum(["MANUAL", "INVALID", "UNSUBSCRIBE", "PROVIDER"]).default("MANUAL"),
  source: z.string().trim().min(1).max(120).default("MANUAL")
});

export type CreateEmailSuppressionInput = z.infer<typeof createEmailSuppressionSchema>;
