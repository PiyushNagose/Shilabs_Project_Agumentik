import { z } from "zod";

const zohoUrlSchema = z.string().trim().pipe(z.url());

const zohoBiginConfiguredSchema = z.object({
  ZOHO_BIGIN_CLIENT_ID: z.string().trim().min(1),
  ZOHO_BIGIN_CLIENT_SECRET: z.string().trim().min(1),
  ZOHO_BIGIN_REFRESH_TOKEN: z.string().trim().min(1),
  ZOHO_BIGIN_ACCOUNTS_URL: zohoUrlSchema.default("https://accounts.zoho.com"),
  ZOHO_BIGIN_API_DOMAIN: zohoUrlSchema.default("https://www.zohoapis.com"),
  ZOHO_BIGIN_REQUIRED_SCOPES: z.string().trim().default("ZohoBigin.modules.ALL"),
  ZOHO_BIGIN_TIMEOUT_MS: z.coerce.number().int().min(100).max(120000).default(30000),
  ZOHO_BIGIN_MAX_RETRIES: z.coerce.number().int().min(0).max(3).default(1),
  ZOHO_BIGIN_TOKEN_SKEW_SECONDS: z.coerce.number().int().min(0).max(600).default(120),
  ZOHO_BIGIN_CONTACTS_MODULE: z.string().trim().min(1).default("Contacts"),
  ZOHO_BIGIN_DEALS_MODULE: z.string().trim().min(1).default("Pipelines"),
  ZOHO_BIGIN_TIMELINE_RELATED_MODULE: z.string().trim().min(1).default("Contacts"),
  ZOHO_BIGIN_SYNC_PER_PAGE: z.coerce.number().int().min(1).max(200).default(200),
  ZOHO_BIGIN_SYNC_MAX_PAGES: z.coerce.number().int().min(1).max(1000).default(25)
});

const zohoBiginRuntimeSchema = z.object({
  ZOHO_BIGIN_ACCOUNTS_URL: zohoUrlSchema.default("https://accounts.zoho.com"),
  ZOHO_BIGIN_API_DOMAIN: zohoUrlSchema.default("https://www.zohoapis.com"),
  ZOHO_BIGIN_REQUIRED_SCOPES: z.string().trim().default("ZohoBigin.modules.ALL"),
  ZOHO_BIGIN_TIMEOUT_MS: z.coerce.number().int().min(100).max(120000).default(30000),
  ZOHO_BIGIN_MAX_RETRIES: z.coerce.number().int().min(0).max(3).default(1),
  ZOHO_BIGIN_TOKEN_SKEW_SECONDS: z.coerce.number().int().min(0).max(600).default(120),
  ZOHO_BIGIN_CONTACTS_MODULE: z.string().trim().min(1).default("Contacts"),
  ZOHO_BIGIN_DEALS_MODULE: z.string().trim().min(1).default("Pipelines"),
  ZOHO_BIGIN_TIMELINE_RELATED_MODULE: z.string().trim().min(1).default("Contacts"),
  ZOHO_BIGIN_SYNC_PER_PAGE: z.coerce.number().int().min(1).max(200).default(200),
  ZOHO_BIGIN_SYNC_MAX_PAGES: z.coerce.number().int().min(1).max(1000).default(25)
});

export interface ZohoBiginConfiguredConfig {
  status: "CONFIGURED";
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  accountsUrl: string;
  apiDomain: string;
  requiredScopes: string[];
  timeoutMs: number;
  maxRetries: number;
  tokenSkewSeconds: number;
  contactsModule: string;
  dealsModule: string;
  timelineRelatedModule: string;
  syncPerPage: number;
  syncMaxPages: number;
}

export interface ZohoBiginNotConfiguredConfig {
  status: "NOT_CONFIGURED";
  missing: string[];
  accountsUrl: string;
  apiDomain: string;
  requiredScopes: string[];
  timeoutMs: number;
  maxRetries: number;
  tokenSkewSeconds: number;
  contactsModule: string;
  dealsModule: string;
  timelineRelatedModule: string;
  syncPerPage: number;
  syncMaxPages: number;
}

export type ZohoBiginConfig = ZohoBiginConfiguredConfig | ZohoBiginNotConfiguredConfig;

const requiredSecretKeys = [
  "ZOHO_BIGIN_CLIENT_ID",
  "ZOHO_BIGIN_CLIENT_SECRET",
  "ZOHO_BIGIN_REFRESH_TOKEN"
] as const;

function splitScopes(value: string): string[] {
  return value
    .split(/[,\s]+/)
    .map((scope) => scope.trim())
    .filter(Boolean);
}

function parseOptionalRuntimeConfig(
  env: NodeJS.ProcessEnv
): Omit<ZohoBiginNotConfiguredConfig, "status" | "missing"> {
  const defaults = zohoBiginRuntimeSchema.parse(env);

  return {
    accountsUrl: defaults.ZOHO_BIGIN_ACCOUNTS_URL,
    apiDomain: defaults.ZOHO_BIGIN_API_DOMAIN,
    requiredScopes: splitScopes(defaults.ZOHO_BIGIN_REQUIRED_SCOPES),
    timeoutMs: defaults.ZOHO_BIGIN_TIMEOUT_MS,
    maxRetries: defaults.ZOHO_BIGIN_MAX_RETRIES,
    tokenSkewSeconds: defaults.ZOHO_BIGIN_TOKEN_SKEW_SECONDS,
    contactsModule: defaults.ZOHO_BIGIN_CONTACTS_MODULE,
    dealsModule: defaults.ZOHO_BIGIN_DEALS_MODULE,
    timelineRelatedModule: defaults.ZOHO_BIGIN_TIMELINE_RELATED_MODULE,
    syncPerPage: defaults.ZOHO_BIGIN_SYNC_PER_PAGE,
    syncMaxPages: defaults.ZOHO_BIGIN_SYNC_MAX_PAGES
  };
}

export function getZohoBiginConfig(env: NodeJS.ProcessEnv = process.env): ZohoBiginConfig {
  const missing = requiredSecretKeys.filter((key) => !env[key]?.trim());
  const runtime = parseOptionalRuntimeConfig(env);

  if (missing.length > 0) {
    return {
      status: "NOT_CONFIGURED",
      missing,
      ...runtime
    };
  }

  const parsed = zohoBiginConfiguredSchema.parse(env);
  return {
    status: "CONFIGURED",
    clientId: parsed.ZOHO_BIGIN_CLIENT_ID,
    clientSecret: parsed.ZOHO_BIGIN_CLIENT_SECRET,
    refreshToken: parsed.ZOHO_BIGIN_REFRESH_TOKEN,
    accountsUrl: parsed.ZOHO_BIGIN_ACCOUNTS_URL,
    apiDomain: parsed.ZOHO_BIGIN_API_DOMAIN,
    requiredScopes: splitScopes(parsed.ZOHO_BIGIN_REQUIRED_SCOPES),
    timeoutMs: parsed.ZOHO_BIGIN_TIMEOUT_MS,
    maxRetries: parsed.ZOHO_BIGIN_MAX_RETRIES,
    tokenSkewSeconds: parsed.ZOHO_BIGIN_TOKEN_SKEW_SECONDS,
    contactsModule: parsed.ZOHO_BIGIN_CONTACTS_MODULE,
    dealsModule: parsed.ZOHO_BIGIN_DEALS_MODULE,
    timelineRelatedModule: parsed.ZOHO_BIGIN_TIMELINE_RELATED_MODULE,
    syncPerPage: parsed.ZOHO_BIGIN_SYNC_PER_PAGE,
    syncMaxPages: parsed.ZOHO_BIGIN_SYNC_MAX_PAGES
  };
}
