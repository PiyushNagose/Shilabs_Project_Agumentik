import { z } from "zod";

export type SemrushConfigStatus = "CONFIGURED" | "NOT_CONFIGURED";

export interface SemrushConfig {
  provider: "SEMRUSH";
  status: SemrushConfigStatus;
  apiKey: string;
  endpoint: string;
  database: string;
  timeoutMs: number;
  maxRetries: number;
  missing: string[];
}

const semrushConfigSchema = z.object({
  SEMRUSH_API_KEY: z.string().trim().default(""),
  SEMRUSH_ENDPOINT: z.url().default("https://api.semrush.com/"),
  SEMRUSH_DATABASE: z.string().trim().min(2).default("us"),
  SEMRUSH_TIMEOUT_MS: z.coerce.number().int().positive().max(120000).default(30000),
  SEMRUSH_MAX_RETRIES: z.coerce.number().int().min(0).max(3).default(1)
});

export function getSemrushConfig(env: NodeJS.ProcessEnv = process.env): SemrushConfig {
  const raw = semrushConfigSchema.parse(env);
  const missing = raw.SEMRUSH_API_KEY ? [] : ["SEMRUSH_API_KEY"];
  return {
    provider: "SEMRUSH",
    status: missing.length > 0 ? "NOT_CONFIGURED" : "CONFIGURED",
    apiKey: raw.SEMRUSH_API_KEY,
    endpoint: raw.SEMRUSH_ENDPOINT,
    database: raw.SEMRUSH_DATABASE,
    timeoutMs: raw.SEMRUSH_TIMEOUT_MS,
    maxRetries: raw.SEMRUSH_MAX_RETRIES,
    missing
  };
}
