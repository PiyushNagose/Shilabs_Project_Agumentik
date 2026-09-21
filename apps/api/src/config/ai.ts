import { z } from "zod";

const sharedAIConfigSchema = z.object({
  AI_TIMEOUT_MS: z.coerce.number().int().min(100).max(120000).default(30000),
  AI_MAX_RETRIES: z.coerce.number().int().min(0).max(2).default(1)
});
const openAIConfigSchema = sharedAIConfigSchema.extend({
  AI_PROVIDER: z.literal("openai"),
  OPENAI_API_KEY: z.string().trim().min(1),
  OPENAI_MODEL: z.string().trim().min(1),
  OPENAI_EMBEDDING_MODEL: z.string().trim().min(1)
});
const geminiAIConfigSchema = sharedAIConfigSchema.extend({
  AI_PROVIDER: z.literal("gemini"),
  GEMINI_API_KEY: z.string().trim().min(1),
  GEMINI_MODEL: z.string().trim().min(1),
  GEMINI_EMBEDDING_MODEL: z.string().trim().min(1)
});
const aiConfigSchema = z.discriminatedUnion("AI_PROVIDER", [
  openAIConfigSchema,
  geminiAIConfigSchema
]);

export type AIConfig = z.infer<typeof aiConfigSchema>;
export type OpenAIConfig = z.infer<typeof openAIConfigSchema>;
export type GeminiAIConfig = z.infer<typeof geminiAIConfigSchema>;

export function getAIConfig(env: NodeJS.ProcessEnv = process.env): AIConfig {
  const result = aiConfigSchema.safeParse(env);
  if (!result.success) {
    const fields = [...new Set(result.error.issues.map((issue) => issue.path.join(".")))];
    throw new Error(`Invalid AI configuration: ${fields.join(", ")}`);
  }
  return result.data;
}
