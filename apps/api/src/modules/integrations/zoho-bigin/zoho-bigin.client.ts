import { z } from "zod";
import type { ZohoBiginConfiguredConfig } from "../../../config/zoho-bigin.js";
import { AppError } from "../../../shared/errors.js";
import type {
  CRMContact,
  CRMDeal,
  CRMTimelineEvent,
  ExternalRecordRef
} from "../../crm/crm.provider.js";

export type FetchTransport = typeof fetch;

export interface ZohoBiginToken {
  accessToken: string;
  apiDomain: string;
  scopes: string[];
  expiresAt: Date;
}

const tokenResponseSchema = z.object({
  access_token: z.string().optional(),
  api_domain: z.url().optional(),
  token_type: z.string().optional(),
  expires_in: z.number().int().positive().optional(),
  scope: z.string().optional(),
  error: z.string().optional(),
  error_description: z.string().optional()
});

const zohoRecordSchema = z.record(z.string(), z.unknown()).and(
  z.object({
    id: z.union([z.string(), z.number()])
  })
);

const recordsResponseSchema = z.object({
  data: z.array(zohoRecordSchema).default([]),
  info: z
    .object({
      more_records: z.boolean().optional()
    })
    .optional()
});

const writeResponseSchema = z.object({
  data: z.array(
    z.object({
      status: z.string().optional(),
      code: z.string().optional(),
      message: z.string().optional(),
      details: z
        .object({
          id: z.union([z.string(), z.number()]).optional()
        })
        .optional()
    })
  )
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function splitScopes(scope: string | undefined): string[] {
  return (scope ?? "")
    .split(/[,\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function hasRequiredScopes(actualScopes: string[], requiredScopes: string[]): boolean {
  if (requiredScopes.length === 0) return true;
  if (actualScopes.includes("ZohoBigin.modules.ALL")) return true;
  return requiredScopes.every((scope) => actualScopes.includes(scope));
}

function buildProviderError(message: string, retryable = false): AppError {
  return new AppError(
    retryable ? 503 : 502,
    retryable ? "RETRYABLE_PROVIDER_ERROR" : "PROVIDER_ERROR",
    message
  );
}

export class ZohoBiginAuthClient {
  private cachedToken: ZohoBiginToken | null = null;

  public constructor(
    private readonly config: ZohoBiginConfiguredConfig,
    private readonly transport: FetchTransport = fetch
  ) {}

  public async getAccessToken(forceRefresh = false): Promise<ZohoBiginToken> {
    if (!forceRefresh && this.cachedToken && this.cachedToken.expiresAt > this.refreshBefore()) {
      return this.cachedToken;
    }

    this.cachedToken = await this.refreshAccessToken();
    return this.cachedToken;
  }

  public async getJson(path: string): Promise<unknown> {
    const token = await this.getAccessToken();
    const response = await this.requestWithRetry(`${token.apiDomain}${path}`, {
      method: "GET",
      headers: {
        Authorization: `Zoho-oauthtoken ${token.accessToken}`
      }
    });

    if (!response.ok) {
      throw buildProviderError(
        `Zoho Bigin API request failed with status ${String(response.status)}`,
        false
      );
    }

    return response.json();
  }

  public async postJson(path: string, body: unknown): Promise<unknown> {
    const token = await this.getAccessToken();
    const response = await this.requestWithRetry(`${token.apiDomain}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Zoho-oauthtoken ${token.accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      throw buildProviderError(
        `Zoho Bigin API write failed with status ${String(response.status)}`,
        false
      );
    }

    return response.json();
  }

  public async listContactsPage(input: {
    page: number;
    perPage: number;
  }): Promise<{ records: CRMContact[]; moreRecords: boolean }> {
    const moduleName = encodeURIComponent(this.config.contactsModule);
    const fields = encodeURIComponent(
      [
        "First_Name",
        "Last_Name",
        "Email",
        "Phone",
        "Mobile",
        "Lead_Source",
        "Modified_Time",
        "Account_Name",
        "Title"
      ].join(",")
    );
    const raw = await this.getJson(
      `/bigin/v2/${moduleName}?fields=${fields}&page=${String(input.page)}&per_page=${String(input.perPage)}`
    );
    const parsed = recordsResponseSchema.safeParse(raw);
    if (!parsed.success) {
      throw buildProviderError("Zoho Bigin contacts response was malformed");
    }

    const contacts = parsed.data.data.map((record) => parseZohoContactRecord(record));
    return {
      records: contacts,
      moreRecords: parsed.data.info?.more_records ?? false
    };
  }

  public async listDealsPage(input: {
    page: number;
    perPage: number;
  }): Promise<{ records: CRMDeal[]; moreRecords: boolean }> {
    const moduleName = encodeURIComponent(this.config.dealsModule);
    const fields = encodeURIComponent(
      [
        "Deal_Name",
        "Pipeline_Name",
        "Contact_Name",
        "Stage",
        "Pipeline_Stage",
        "Sub_Pipeline",
        "Amount",
        "Deal_Value",
        "Expected_Revenue",
        "Currency",
        "Probability",
        "Status",
        "Modified_Time"
      ].join(",")
    );
    const raw = await this.getJson(
      `/bigin/v2/${moduleName}?fields=${fields}&page=${String(input.page)}&per_page=${String(input.perPage)}`
    );
    const parsed = recordsResponseSchema.safeParse(raw);
    if (!parsed.success) {
      throw buildProviderError("Zoho Bigin deals response was malformed");
    }

    return {
      records: parsed.data.data.map((record) => parseZohoDealRecord(record)),
      moreRecords: parsed.data.info?.more_records ?? false
    };
  }

  public async appendTimelineEvent(input: CRMTimelineEvent): Promise<ExternalRecordRef> {
    const relatedModule = encodeURIComponent(this.config.timelineRelatedModule);
    const relatedId = encodeURIComponent(input.relatedExternalRecordId);
    const raw = await this.postJson(`/bigin/v2/${relatedModule}/${relatedId}/Notes`, {
      data: [
        {
          Note_Title: input.title,
          Note_Content: input.description
        }
      ]
    });
    const parsed = writeResponseSchema.safeParse(raw);
    if (!parsed.success) {
      throw buildProviderError("Zoho Bigin timeline response was malformed");
    }

    const result = parsed.data.data[0];
    if (!result || result.status?.toLowerCase() === "error" || !result.details?.id) {
      throw buildProviderError(`Zoho Bigin timeline write failed: ${result?.code ?? "UNKNOWN"}`);
    }

    return {
      provider: "ZOHO_BIGIN",
      entityType: "ACTIVITY",
      externalRecordId: String(result.details.id)
    };
  }

  public async verifyConnection(): Promise<ZohoBiginToken> {
    const token = await this.getAccessToken(true);
    await this.getJson("/bigin/v2/Contacts?fields=Last_Name,Email&per_page=1");
    return token;
  }

  private refreshBefore(): Date {
    return new Date(Date.now() + this.config.tokenSkewSeconds * 1000);
  }

  private async refreshAccessToken(): Promise<ZohoBiginToken> {
    const body = new URLSearchParams({
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      refresh_token: this.config.refreshToken,
      grant_type: "refresh_token"
    });

    const response = await this.requestWithRetry(`${this.config.accountsUrl}/oauth/v2/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body
    });

    const rawBody: unknown = await response.json().catch(() => null);
    const parsed = tokenResponseSchema.safeParse(rawBody);
    if (!parsed.success) {
      throw buildProviderError("Zoho Bigin token response was malformed");
    }

    const tokenBody = parsed.data;
    if (tokenBody.error) {
      throw buildProviderError(`Zoho Bigin OAuth error: ${tokenBody.error}`);
    }

    if (!response.ok || !tokenBody.access_token || !tokenBody.expires_in) {
      throw buildProviderError(
        `Zoho Bigin token refresh failed with status ${String(response.status)}`
      );
    }

    const scopes = splitScopes(tokenBody.scope);
    if (!hasRequiredScopes(scopes, this.config.requiredScopes)) {
      throw buildProviderError("Zoho Bigin token is missing required scopes");
    }

    return {
      accessToken: tokenBody.access_token,
      apiDomain: tokenBody.api_domain ?? this.config.apiDomain,
      scopes,
      expiresAt: new Date(Date.now() + tokenBody.expires_in * 1000)
    };
  }

  private async requestWithRetry(url: string, init: RequestInit): Promise<Response> {
    for (let attempt = 0; attempt <= this.config.maxRetries; attempt += 1) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);
        const response = await this.transport(url, { ...init, signal: controller.signal });
        clearTimeout(timeout);

        if (!isRetryableStatus(response.status) || attempt === this.config.maxRetries) {
          return response;
        }
      } catch {
        if (attempt === this.config.maxRetries) break;
      }

      await sleep(250 * (attempt + 1));
    }

    throw buildProviderError("Zoho Bigin request failed after retries", true);
  }
}

function readString(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number") return String(value);
  }

  return undefined;
}

function readZohoRef(
  record: Record<string, unknown>,
  keys: string[]
): { id: string; name: string } | null {
  for (const key of keys) {
    const value = record[key];
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const object = value as Record<string, unknown>;
    const id = readString(object, ["id"]);
    const name = readString(object, ["name", "Name"]);
    if (id && name) return { id, name };
  }

  return null;
}

function readDate(record: Record<string, unknown>, keys: string[]): Date | undefined {
  const value = readString(record, keys);
  if (!value) return undefined;

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return date;
}

function parseZohoContactRecord(record: Record<string, unknown>): CRMContact {
  const externalRecordId = readString(record, ["id"]);
  const fullName = readString(record, ["Full_Name", "Contact_Name", "Name"]);
  const firstName = readString(record, ["First_Name"]) ?? fullName?.split(" ")[0];
  const lastName =
    readString(record, ["Last_Name"]) ??
    (fullName ? fullName.split(" ").slice(1).join(" ").trim() || "(unknown)" : undefined);
  const companyRef = readZohoRef(record, ["Account_Name", "Company", "Account"]);

  if (!externalRecordId || !firstName) {
    throw buildProviderError("Zoho Bigin contact is missing required identity fields (id or first name)");
  }

  const resolvedLastName = lastName ?? "(unknown)";
  const resolvedCompany = companyRef ?? {
    id: externalRecordId,
    name: `${firstName} ${resolvedLastName}`.trim()
  };

  return {
    externalRecordId,
    externalVersion: readString(record, ["Modified_Time"]),
    externalUpdatedAt: readDate(record, ["Modified_Time"]),
    firstName,
    lastName: resolvedLastName,
    title: readString(record, ["Title", "Designation"]),
    email: readString(record, ["Email"]),
    phone: readString(record, ["Phone", "Mobile"]),
    whatsappId: readString(record, ["WhatsApp", "Whatsapp", "WhatsApp_ID"]),
    source: readString(record, ["Lead_Source", "Source"]),
    company: {
      externalRecordId: resolvedCompany.id,
      name: resolvedCompany.name,
      website: readString(record, ["Website"])
    }
  };
}

function readNumber(record: Record<string, unknown>, keys: string[]): number | undefined {
  const value = readString(record, keys);
  if (!value) return undefined;

  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function parseZohoDealRecord(record: Record<string, unknown>): CRMDeal {
  const externalRecordId = readString(record, ["id"]);
  const name = readString(record, ["Deal_Name", "Pipeline_Name", "Name"]);
  const contactRef = readZohoRef(record, ["Contact_Name", "Contact", "Associated_Contact"]);

  if (!externalRecordId || !name || !contactRef) {
    throw buildProviderError("Zoho Bigin deal is missing required identity fields");
  }

  return {
    externalRecordId,
    externalVersion: readString(record, ["Modified_Time"]),
    externalUpdatedAt: readDate(record, ["Modified_Time"]),
    relatedLeadExternalRecordId: contactRef.id,
    name,
    stageName: readString(record, ["Stage", "Pipeline_Stage", "Sub_Pipeline"]),
    value: readString(record, ["Amount", "Deal_Value", "Expected_Revenue"]),
    currency: readString(record, ["Currency"]),
    probability: readNumber(record, ["Probability"]),
    status: readString(record, ["Status"])
  };
}
