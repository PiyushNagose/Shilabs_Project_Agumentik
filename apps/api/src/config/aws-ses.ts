import { z } from "zod";

export type AwsSesConfigStatus = "CONFIGURED" | "NOT_CONFIGURED";

export interface AwsSesBaseConfig {
  provider: "AWS_SES";
  status: AwsSesConfigStatus;
  region: string;
  fromEmail: string;
  replyToEmail: string | null;
  configurationSet: string | null;
  timeoutMs: number;
  maxRetries: number;
  missing: string[];
  useDefaultCredentialChain: boolean;
}

export interface AwsSesConfiguredConfig extends AwsSesBaseConfig {
  status: "CONFIGURED";
  accessKeyId?: string;
  secretAccessKey?: string;
  webhookSecret: string;
}

export interface AwsSesNotConfiguredConfig extends AwsSesBaseConfig {
  status: "NOT_CONFIGURED";
}

export type AwsSesConfig = AwsSesConfiguredConfig | AwsSesNotConfiguredConfig;

const rawAwsSesConfigSchema = z.object({
  AWS_SES_REGION: z.string().trim().default(""),
  AWS_SES_FROM_EMAIL: z.string().trim().default(""),
  AWS_SES_REPLY_TO_EMAIL: z.string().trim().default(""),
  AWS_SES_CONFIGURATION_SET: z.string().trim().default(""),
  AWS_SES_ACCESS_KEY_ID: z.string().trim().default(""),
  AWS_SES_SECRET_ACCESS_KEY: z.string().trim().default(""),
  AWS_SES_USE_DEFAULT_CREDENTIAL_CHAIN: z
    .enum(["true", "false"])
    .catch("false")
    .default("false"),
  AWS_SES_WEBHOOK_SECRET: z.string().trim().default(""),
  AWS_SES_TIMEOUT_MS: z.coerce.number().int().positive().default(30000),
  AWS_SES_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(1)
});

const emailSchema = z.email();

export function getAwsSesConfig(env: NodeJS.ProcessEnv = process.env): AwsSesConfig {
  const raw = rawAwsSesConfigSchema.parse(env);
  const useDefaultCredentialChain = raw.AWS_SES_USE_DEFAULT_CREDENTIAL_CHAIN === "true";
  const missing: string[] = [];

  if (!raw.AWS_SES_REGION) missing.push("AWS_SES_REGION");
  if (!raw.AWS_SES_FROM_EMAIL) missing.push("AWS_SES_FROM_EMAIL");
  if (!raw.AWS_SES_WEBHOOK_SECRET) missing.push("AWS_SES_WEBHOOK_SECRET");
  if (!useDefaultCredentialChain && !raw.AWS_SES_ACCESS_KEY_ID) {
    missing.push("AWS_SES_ACCESS_KEY_ID");
  }
  if (!useDefaultCredentialChain && !raw.AWS_SES_SECRET_ACCESS_KEY) {
    missing.push("AWS_SES_SECRET_ACCESS_KEY");
  }

  if (raw.AWS_SES_FROM_EMAIL) emailSchema.parse(raw.AWS_SES_FROM_EMAIL);
  if (raw.AWS_SES_REPLY_TO_EMAIL) emailSchema.parse(raw.AWS_SES_REPLY_TO_EMAIL);

  const base = {
    provider: "AWS_SES" as const,
    region: raw.AWS_SES_REGION,
    fromEmail: raw.AWS_SES_FROM_EMAIL,
    replyToEmail: raw.AWS_SES_REPLY_TO_EMAIL || null,
    configurationSet: raw.AWS_SES_CONFIGURATION_SET || null,
    timeoutMs: raw.AWS_SES_TIMEOUT_MS,
    maxRetries: raw.AWS_SES_MAX_RETRIES,
    missing,
    useDefaultCredentialChain
  };

  if (missing.length > 0) {
    return {
      ...base,
      status: "NOT_CONFIGURED"
    };
  }

  return {
    ...base,
    status: "CONFIGURED",
    accessKeyId: useDefaultCredentialChain ? undefined : raw.AWS_SES_ACCESS_KEY_ID,
    secretAccessKey: useDefaultCredentialChain ? undefined : raw.AWS_SES_SECRET_ACCESS_KEY,
    webhookSecret: raw.AWS_SES_WEBHOOK_SECRET
  };
}
