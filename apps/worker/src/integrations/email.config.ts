import { getWorkerAwsSesConfig, type WorkerAwsSesConfig } from "./aws-ses.config.js";

export interface WorkerMailpitConfig {
  provider: "MAILPIT";
  status: "CONFIGURED" | "NOT_CONFIGURED";
  host: string;
  port: number;
  secure: boolean;
  fromEmail: string;
  replyToEmail: string | null;
  timeoutMs: number;
  missing: string[];
}

export type WorkerSelectedEmailConfig =
  ({ provider: "AWS_SES" } & WorkerAwsSesConfig) | WorkerMailpitConfig;

const localMailpitHosts = new Set(["localhost", "127.0.0.1", "::1", "mailpit", "shilabs-mailpit"]);

function runtimeEnvironment(env: NodeJS.ProcessEnv): string {
  return (env.APP_ENV ?? env.NODE_ENV ?? "development").toLowerCase();
}

function getMailpitConfig(env: NodeJS.ProcessEnv): WorkerMailpitConfig {
  const missing: string[] = [];
  const host = env.MAILPIT_SMTP_HOST ?? "localhost";
  const port = Number(env.MAILPIT_SMTP_PORT ?? 1025);
  const fromEmail = env.MAILPIT_FROM_EMAIL ?? "sales@shilabs.local";

  if (runtimeEnvironment(env) === "production") missing.push("MAILPIT_DISABLED_IN_PRODUCTION");
  if (!localMailpitHosts.has(host)) missing.push("MAILPIT_SMTP_HOST must be a local Mailpit host");
  if (!Number.isInteger(port) || port <= 0) missing.push("MAILPIT_SMTP_PORT");
  if (!fromEmail) missing.push("MAILPIT_FROM_EMAIL");

  return {
    provider: "MAILPIT",
    status: missing.length > 0 ? "NOT_CONFIGURED" : "CONFIGURED",
    host,
    port,
    secure: env.MAILPIT_SMTP_SECURE === "true",
    fromEmail,
    replyToEmail: env.MAILPIT_REPLY_TO_EMAIL ?? null,
    timeoutMs: Number(env.MAILPIT_TIMEOUT_MS ?? 10000),
    missing
  };
}

export function getWorkerSelectedEmailConfig(
  env: NodeJS.ProcessEnv = process.env
): WorkerSelectedEmailConfig {
  if ((env.EMAIL_PROVIDER ?? "AWS_SES") === "MAILPIT") return getMailpitConfig(env);
  return { provider: "AWS_SES", ...getWorkerAwsSesConfig(env) };
}
