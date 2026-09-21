import type { IntegrationHealthDto } from "@shilabs/shared-types";
import { getZohoBiginConfig } from "../../../config/zoho-bigin.js";
import { upsertIntegrationAccount } from "../integration-mapping.repository.js";
import { ZohoBiginAuthClient, type FetchTransport } from "./zoho-bigin.client.js";
import { ZohoBiginProvider } from "./zoho-bigin.provider.js";

function sanitizeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "Zoho Bigin connectivity check failed";
}

export async function getZohoBiginHealth(input?: {
  env?: NodeJS.ProcessEnv;
  transport?: FetchTransport;
}): Promise<IntegrationHealthDto> {
  const checkedAt = new Date();
  const configResult = await loadConfigForHealth(input?.env, checkedAt);
  if ("health" in configResult) return configResult.health;
  const config = configResult.config;

  if (config.status === "NOT_CONFIGURED") {
    const account = await upsertIntegrationAccount({
      provider: "ZOHO_BIGIN",
      key: "default",
      displayName: "Zoho Bigin",
      status: "NOT_CONFIGURED",
      secretRef: "env:ZOHO_BIGIN_CLIENT_SECRET",
      publicConfig: {
        accountsUrl: config.accountsUrl,
        apiDomain: config.apiDomain,
        requiredScopes: config.requiredScopes
      },
      lastCheckedAt: checkedAt,
      lastError: `Missing configuration: ${config.missing.join(", ")}`
    });

    return {
      provider: "ZOHO_BIGIN",
      status: "NOT_CONFIGURED",
      configured: false,
      checkedAt: checkedAt.toISOString(),
      accountId: account.id,
      apiDomain: config.apiDomain,
      accountsUrl: config.accountsUrl,
      missingConfig: config.missing,
      scopes: config.requiredScopes,
      tokenExpiresAt: null,
      lastError: account.lastError
    };
  }

  try {
    const client = new ZohoBiginAuthClient(config, input?.transport);
    const provider = new ZohoBiginProvider(client);
    const token = await provider.verifyConnection();
    const account = await upsertIntegrationAccount({
      provider: "ZOHO_BIGIN",
      key: "default",
      displayName: "Zoho Bigin",
      status: "CONFIGURED",
      secretRef: "env:ZOHO_BIGIN_CLIENT_SECRET",
      publicConfig: {
        accountsUrl: config.accountsUrl,
        apiDomain: token.apiDomain,
        requiredScopes: config.requiredScopes
      },
      lastCheckedAt: checkedAt,
      lastError: null
    });

    return {
      provider: "ZOHO_BIGIN",
      status: "CONFIGURED",
      configured: true,
      checkedAt: checkedAt.toISOString(),
      accountId: account.id,
      apiDomain: token.apiDomain,
      accountsUrl: config.accountsUrl,
      missingConfig: [],
      scopes: token.scopes,
      tokenExpiresAt: token.expiresAt.toISOString(),
      lastError: null
    };
  } catch (error) {
    const lastError = sanitizeError(error);
    const account = await upsertIntegrationAccount({
      provider: "ZOHO_BIGIN",
      key: "default",
      displayName: "Zoho Bigin",
      status: "ERROR",
      secretRef: "env:ZOHO_BIGIN_CLIENT_SECRET",
      publicConfig: {
        accountsUrl: config.accountsUrl,
        apiDomain: config.apiDomain,
        requiredScopes: config.requiredScopes
      },
      lastCheckedAt: checkedAt,
      lastError
    });

    return {
      provider: "ZOHO_BIGIN",
      status: "ERROR",
      configured: true,
      checkedAt: checkedAt.toISOString(),
      accountId: account.id,
      apiDomain: config.apiDomain,
      accountsUrl: config.accountsUrl,
      missingConfig: [],
      scopes: config.requiredScopes,
      tokenExpiresAt: null,
      lastError
    };
  }
}

async function loadConfigForHealth(
  env: NodeJS.ProcessEnv | undefined,
  checkedAt: Date
): Promise<{ config: ReturnType<typeof getZohoBiginConfig> } | { health: IntegrationHealthDto }> {
  try {
    return { config: getZohoBiginConfig(env) };
  } catch (error) {
    const lastError = sanitizeError(error);
    const account = await upsertIntegrationAccount({
      provider: "ZOHO_BIGIN",
      key: "default",
      displayName: "Zoho Bigin",
      status: "ERROR",
      secretRef: "env:ZOHO_BIGIN_CLIENT_SECRET",
      publicConfig: undefined,
      lastCheckedAt: checkedAt,
      lastError
    });

    return {
      health: {
        provider: "ZOHO_BIGIN",
        status: "ERROR",
        configured: false,
        checkedAt: checkedAt.toISOString(),
        accountId: account.id,
        apiDomain: null,
        accountsUrl: null,
        missingConfig: [],
        scopes: [],
        tokenExpiresAt: null,
        lastError
      }
    };
  }
}
