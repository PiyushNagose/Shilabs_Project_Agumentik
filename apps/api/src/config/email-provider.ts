import { z } from "zod";
import { getAwsSesConfig, type AwsSesConfig } from "./aws-ses.js";

export type EmailProviderName = "AWS_SES" | "MAILPIT";
export type EmailProviderConfigStatus = "CONFIGURED" | "NOT_CONFIGURED";

export interface MailpitEmailConfig {
  provider: "MAILPIT";
  status: EmailProviderConfigStatus;
  host: string;
  port: number;
  secure: boolean;
  fromEmail: string;
  replyToEmail: string | null;
  timeoutMs: number;
  missing: string[];
}

export type SelectedEmailProviderConfig =
  ({ provider: "AWS_SES" } & AwsSesConfig) | MailpitEmailConfig;

const emailProviderSchema = z.object({
  EMAIL_PROVIDER: z.enum(["AWS_SES", "MAILPIT"]).catch("AWS_SES").default("AWS_SES"),
  NODE_ENV: z.string().trim().default("development"),
  APP_ENV: z.string().trim().default(""),
  ALLOW_EXTERNAL_EMAIL_IN_NON_PRODUCTION: z.enum(["true", "false"]).catch("false").default("false"),
  MAILPIT_SMTP_HOST: z.string().trim().default("localhost"),
  MAILPIT_SMTP_PORT: z.coerce.number().int().positive().default(1025),
  MAILPIT_SMTP_SECURE: z.enum(["true", "false"]).catch("false").default("false"),
  MAILPIT_FROM_EMAIL: z.string().trim().default("sales@shilabs.local"),
  MAILPIT_REPLY_TO_EMAIL: z.string().trim().default(""),
  MAILPIT_TIMEOUT_MS: z.coerce.number().int().positive().default(10000)
});

const emailSchema = z.email();
const localMailpitHosts = new Set(["localhost", "127.0.0.1", "::1", "mailpit", "shilabs-mailpit"]);

function runtimeEnvironment(raw: z.infer<typeof emailProviderSchema>): string {
  return (raw.APP_ENV || raw.NODE_ENV || "development").toLowerCase();
}

function isNonProductionRuntime(runtime: string): boolean {
  return runtime !== "production" && runtime !== "test";
}

function sanitizeAwsAsNotConfigured(
  config: AwsSesConfig,
  missing: string[]
): SelectedEmailProviderConfig {
  return {
    provider: "AWS_SES",
    status: "NOT_CONFIGURED",
    region: config.region,
    fromEmail: config.fromEmail,
    replyToEmail: config.replyToEmail,
    configurationSet: config.configurationSet,
    timeoutMs: config.timeoutMs,
    maxRetries: config.maxRetries,
    missing,
    useDefaultCredentialChain: config.useDefaultCredentialChain
  };
}

function getMailpitConfig(raw: z.infer<typeof emailProviderSchema>): MailpitEmailConfig {
  const runtime = runtimeEnvironment(raw);
  const missing: string[] = [];

  if (runtime === "production") {
    missing.push("MAILPIT_DISABLED_IN_PRODUCTION");
  }
  if (!localMailpitHosts.has(raw.MAILPIT_SMTP_HOST)) {
    missing.push("MAILPIT_SMTP_HOST must be a local Mailpit host");
  }
  if (!raw.MAILPIT_FROM_EMAIL) {
    missing.push("MAILPIT_FROM_EMAIL");
  } else {
    emailSchema.parse(raw.MAILPIT_FROM_EMAIL);
  }
  if (raw.MAILPIT_REPLY_TO_EMAIL) {
    emailSchema.parse(raw.MAILPIT_REPLY_TO_EMAIL);
  }

  return {
    provider: "MAILPIT",
    status: missing.length > 0 ? "NOT_CONFIGURED" : "CONFIGURED",
    host: raw.MAILPIT_SMTP_HOST,
    port: raw.MAILPIT_SMTP_PORT,
    secure: raw.MAILPIT_SMTP_SECURE === "true",
    fromEmail: raw.MAILPIT_FROM_EMAIL,
    replyToEmail: raw.MAILPIT_REPLY_TO_EMAIL || null,
    timeoutMs: raw.MAILPIT_TIMEOUT_MS,
    missing
  };
}

export function getSelectedEmailProviderConfig(
  env: NodeJS.ProcessEnv = process.env
): SelectedEmailProviderConfig {
  const raw = emailProviderSchema.parse(env);
  if (raw.EMAIL_PROVIDER === "MAILPIT") {
    return getMailpitConfig(raw);
  }

  const config = getAwsSesConfig(env);
  if (
    config.status === "CONFIGURED" &&
    isNonProductionRuntime(runtimeEnvironment(raw)) &&
    raw.ALLOW_EXTERNAL_EMAIL_IN_NON_PRODUCTION !== "true"
  ) {
    return sanitizeAwsAsNotConfigured(config, ["ALLOW_EXTERNAL_EMAIL_IN_NON_PRODUCTION"]);
  }

  return config;
}
