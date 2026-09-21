export interface WorkerAwsSesConfig {
  status: "CONFIGURED" | "NOT_CONFIGURED";
  region: string;
  fromEmail: string;
  replyToEmail: string | null;
  configurationSet: string | null;
  accessKeyId?: string;
  secretAccessKey?: string;
  useDefaultCredentialChain: boolean;
  timeoutMs: number;
  maxRetries: number;
  missing: string[];
}

export function getWorkerAwsSesConfig(env: NodeJS.ProcessEnv = process.env): WorkerAwsSesConfig {
  const useDefaultCredentialChain = env.AWS_SES_USE_DEFAULT_CREDENTIAL_CHAIN === "true";
  const missing: string[] = [];
  if (!env.AWS_SES_REGION) missing.push("AWS_SES_REGION");
  if (!env.AWS_SES_FROM_EMAIL) missing.push("AWS_SES_FROM_EMAIL");
  if (!useDefaultCredentialChain && !env.AWS_SES_ACCESS_KEY_ID) missing.push("AWS_SES_ACCESS_KEY_ID");
  if (!useDefaultCredentialChain && !env.AWS_SES_SECRET_ACCESS_KEY) {
    missing.push("AWS_SES_SECRET_ACCESS_KEY");
  }
  return {
    status: missing.length > 0 ? "NOT_CONFIGURED" : "CONFIGURED",
    region: env.AWS_SES_REGION ?? "",
    fromEmail: env.AWS_SES_FROM_EMAIL ?? "",
    replyToEmail:
      env.AWS_SES_REPLY_TO_EMAIL && env.AWS_SES_REPLY_TO_EMAIL.length > 0
        ? env.AWS_SES_REPLY_TO_EMAIL
        : null,
    configurationSet:
      env.AWS_SES_CONFIGURATION_SET && env.AWS_SES_CONFIGURATION_SET.length > 0
        ? env.AWS_SES_CONFIGURATION_SET
        : null,
    accessKeyId: useDefaultCredentialChain ? undefined : env.AWS_SES_ACCESS_KEY_ID,
    secretAccessKey: useDefaultCredentialChain ? undefined : env.AWS_SES_SECRET_ACCESS_KEY,
    useDefaultCredentialChain,
    timeoutMs: Number(env.AWS_SES_TIMEOUT_MS ?? 30000),
    maxRetries: Number(env.AWS_SES_MAX_RETRIES ?? 1),
    missing
  };
}
