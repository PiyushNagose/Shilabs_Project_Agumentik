import { z } from "zod";

export const categories = ["email", "messages", "calls", "providerPayloads", "ai", "files", "audit", "deletedRecords"] as const;
export type PrivacyCategory = (typeof categories)[number];
const days = z.number().int().min(1).max(36500).nullable();
export const policySchema = z.object({
  enabled: z.boolean(),
  revision: z.number().int().min(0),
  periods: z.object(Object.fromEntries(categories.map((key) => [key, days.optional()])) as Record<PrivacyCategory, z.ZodOptional<typeof days>>).strict()
}).strict();
export type PrivacyPolicyInput = z.infer<typeof policySchema>;
export const applySchema = z.object({ previewId: z.string().min(1).max(100), confirmation: z.literal("APPLY CLEANUP") }).strict();
export const eraseSchema = z.object({ confirmation: z.literal("ERASE CONTACT") }).strict();
