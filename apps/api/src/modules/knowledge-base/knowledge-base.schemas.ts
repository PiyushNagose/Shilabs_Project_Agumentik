import { z } from "zod";

const nullableSourceUrl = z
  .url()
  .trim()
  .max(1000)
  .nullable()
  .optional();

export const knowledgeBaseCategorySchema = z.enum([
  "COMPANY",
  "SERVICE",
  "PROPOSAL",
  "SEO",
  "WEB_DESIGN",
  "GENERAL"
]);

export const listKnowledgeBaseQuerySchema = z.object({
  category: knowledgeBaseCategorySchema.optional(),
  status: z.enum(["DRAFT", "APPROVED", "INACTIVE"]).optional(),
  q: z.string().trim().min(1).max(120).optional()
});

export const approvedKnowledgeQuerySchema = z.object({
  category: knowledgeBaseCategorySchema.optional(),
  q: z.string().trim().min(1).max(120).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20)
});

export const createKnowledgeBaseEntrySchema = z.object({
  key: z
    .string()
    .trim()
    .min(3)
    .max(120)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u, "Use lowercase kebab-case keys"),
  title: z.string().trim().min(3).max(200),
  category: knowledgeBaseCategorySchema,
  content: z.string().trim().min(20).max(20000),
  sourceTitle: z.string().trim().min(3).max(300),
  sourceUrl: nullableSourceUrl,
  sourceType: z.string().trim().min(2).max(80),
  approve: z.boolean().default(false)
});

export const updateKnowledgeBaseEntrySchema = z
  .object({
    title: z.string().trim().min(3).max(200).optional(),
    category: knowledgeBaseCategorySchema.optional(),
    status: z.enum(["DRAFT", "APPROVED", "INACTIVE"]).optional()
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field is required"
  });

export const createKnowledgeBaseCorrectionSchema = z.object({
  content: z.string().trim().min(20).max(20000),
  sourceTitle: z.string().trim().min(3).max(300),
  sourceUrl: nullableSourceUrl,
  sourceType: z.string().trim().min(2).max(80),
  reason: z.string().trim().min(3).max(500),
  approve: z.boolean().default(true)
});

export type ListKnowledgeBaseQuery = z.infer<typeof listKnowledgeBaseQuerySchema>;
export type ApprovedKnowledgeQuery = z.infer<typeof approvedKnowledgeQuerySchema>;
export type CreateKnowledgeBaseEntryInput = z.infer<typeof createKnowledgeBaseEntrySchema>;
export type UpdateKnowledgeBaseEntryInput = z.infer<typeof updateKnowledgeBaseEntrySchema>;
export type CreateKnowledgeBaseCorrectionInput = z.infer<
  typeof createKnowledgeBaseCorrectionSchema
>;
