import crypto from "node:crypto";
import type { MessagingConfig } from "@shilabs/shared-config";
import { redactSecrets } from "../../shared/redaction.js";

export interface MessagingHealthDto {
  provider: "META_WHATSAPP" | "TWILIO_WHATSAPP" | "NONE";
  status: "CONFIGURED" | "NOT_CONFIGURED" | "ERROR";
  configured: boolean;
  checkedAt: string;
  missingConfig: string[];
  webhookConfigured: boolean;
  templatePolicyMode: MessagingConfig["templatePolicyMode"];
  defaultTemplateConfigured: boolean;
  lastError: string | null;
}

export interface MessagingProvider {
  getHealth(): Promise<MessagingHealthDto>;
  verifyWebhookSignature(input: { rawBody: string; signature: string | undefined }): boolean;
}

export interface TwilioWhatsAppSignatureInput {
  url: string;
  params: Record<string, string>;
  signature: string | undefined;
}

export type MessagingTransport = typeof fetch;

export interface WhatsAppTextSendResult {
  status: "ACCEPTED" | "FAILED" | "NOT_CONFIGURED" | "UNCERTAIN";
  providerMessageId: string | null;
  providerStatus: string | null;
  lastError: string | null;
}

export async function sendWhatsAppText(
  config: MessagingConfig,
  input: { to: string; body: string; idempotencyKey: string; replyToProviderMessageId?: string | null },
  transport: MessagingTransport = fetch
): Promise<WhatsAppTextSendResult> {
  const missing = config.provider === "meta_whatsapp"
    ? [
        !config.metaWhatsApp.accessToken && "WHATSAPP_ACCESS_TOKEN",
        !config.metaWhatsApp.phoneNumberId && "WHATSAPP_PHONE_NUMBER_ID"
      ].filter((value): value is string => Boolean(value))
    : config.provider === "twilio_whatsapp"
      ? [
          !config.twilioWhatsApp.accountSid && "TWILIO_WHATSAPP_ACCOUNT_SID",
          !config.twilioWhatsApp.authToken && "TWILIO_WHATSAPP_AUTH_TOKEN",
          !config.twilioWhatsApp.sandboxFrom && "TWILIO_WHATSAPP_SANDBOX_FROM"
        ].filter((value): value is string => Boolean(value))
      : ["MESSAGING_PROVIDER"];
  if (missing.length > 0) {
    return {
      status: "NOT_CONFIGURED",
      providerMessageId: null,
      providerStatus: null,
      lastError: `Missing configuration: ${missing.join(", ")}`
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  let responseStatus: number | null = null;
  try {
    if (config.provider === "meta_whatsapp") {
      const response = await transport(
        `${config.metaWhatsApp.graphApiBaseUrl.replace(/\/$/u, "")}/${encodeURIComponent(config.metaWhatsApp.phoneNumberId)}/messages`,
        {
          method: "POST",
          signal: controller.signal,
          headers: {
            Authorization: `Bearer ${config.metaWhatsApp.accessToken}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            messaging_product: "whatsapp",
            to: input.to.replace(/^\+/u, ""),
            type: "text",
            text: { body: input.body, preview_url: false },
            ...(input.replyToProviderMessageId
              ? { context: { message_id: input.replyToProviderMessageId } }
              : {})
          })
        }
      );
      responseStatus = response.status;
      const data = await parseJson(response);
      if (!response.ok) throw new Error(metaErrorMessage(response.status, data));
      const messages: unknown = data?.messages;
      const first: unknown = Array.isArray(messages) ? (messages as unknown[])[0] : null;
      const firstRecord = first && typeof first === "object" && !Array.isArray(first)
        ? first as Record<string, unknown> : null;
      const providerMessageId = typeof firstRecord?.id === "string" ? firstRecord.id : null;
      if (!providerMessageId) throw new Error("WhatsApp provider did not return a message ID");
      return { status: "ACCEPTED", providerMessageId, providerStatus: "accepted", lastError: null };
    }
    const payload = new URLSearchParams({
      From: `whatsapp:${config.twilioWhatsApp.sandboxFrom.replace(/^whatsapp:/iu, "")}`,
      To: `whatsapp:${input.to.replace(/^whatsapp:/iu, "")}`,
      Body: input.body
    });
    const response = await transport(
      `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(config.twilioWhatsApp.accountSid)}/Messages.json`,
      {
        method: "POST",
        signal: controller.signal,
        headers: {
          Authorization: `Basic ${Buffer.from(`${config.twilioWhatsApp.accountSid}:${config.twilioWhatsApp.authToken}`).toString("base64")}`,
          "Content-Type": "application/x-www-form-urlencoded",
          "Idempotency-Key": input.idempotencyKey
        },
        body: payload
      }
    );
    responseStatus = response.status;
    const data = await parseJson(response);
    if (!response.ok) throw new Error(metaErrorMessage(response.status, data));
    if (typeof data?.sid !== "string") throw new Error("WhatsApp provider did not return a message ID");
    return {
      status: "ACCEPTED",
      providerMessageId: data.sid,
      providerStatus: typeof data.status === "string" ? data.status : "accepted",
      lastError: null
    };
  } catch (error) {
    return {
      status: responseStatus === null || responseStatus >= 500 || [408, 409, 429].includes(responseStatus) || responseStatus < 300
        ? "UNCERTAIN" : "FAILED",
      providerMessageId: null,
      providerStatus: null,
      lastError: responseStatus === null || responseStatus >= 500 || responseStatus < 300
        ? "WhatsApp delivery could not be confirmed. Check the provider before sending another reply."
        : sanitizeError(error)
    };
  } finally {
    clearTimeout(timeout);
  }
}

function missingMetaConfig(config: MessagingConfig): string[] {
  const missing: string[] = [];
  if (config.provider !== "meta_whatsapp") missing.push("MESSAGING_PROVIDER");
  if (!config.metaWhatsApp.accessToken) missing.push("WHATSAPP_ACCESS_TOKEN");
  if (!config.metaWhatsApp.phoneNumberId) missing.push("WHATSAPP_PHONE_NUMBER_ID");
  if (!config.metaWhatsApp.webhookVerifyToken) missing.push("WHATSAPP_WEBHOOK_VERIFY_TOKEN");
  if (!config.metaWhatsApp.appSecret) missing.push("WHATSAPP_APP_SECRET");
  if (!config.metaWhatsApp.defaultTemplateName) missing.push("WHATSAPP_DEFAULT_TEMPLATE_NAME");
  return missing;
}

function missingTwilioConfig(config: MessagingConfig): string[] {
  const missing: string[] = [];
  if (config.provider !== "twilio_whatsapp") missing.push("MESSAGING_PROVIDER");
  if (!config.twilioWhatsApp.accountSid) missing.push("TWILIO_WHATSAPP_ACCOUNT_SID");
  if (!config.twilioWhatsApp.authToken) missing.push("TWILIO_WHATSAPP_AUTH_TOKEN");
  if (!config.twilioWhatsApp.sandboxFrom) missing.push("TWILIO_WHATSAPP_SANDBOX_FROM");
  return missing;
}

function baseHealth(
  config: MessagingConfig,
  status: MessagingHealthDto["status"]
): MessagingHealthDto {
  return {
    provider:
      config.provider === "meta_whatsapp"
        ? "META_WHATSAPP"
        : config.provider === "twilio_whatsapp"
          ? "TWILIO_WHATSAPP"
          : "NONE",
    status,
    configured: status === "CONFIGURED",
    checkedAt: new Date().toISOString(),
    missingConfig: [],
    webhookConfigured: Boolean(
      config.metaWhatsApp.webhookVerifyToken && config.metaWhatsApp.appSecret
    ),
    templatePolicyMode: config.templatePolicyMode,
    defaultTemplateConfigured: Boolean(config.metaWhatsApp.defaultTemplateName),
    lastError: null
  };
}

function sanitizeError(error: unknown): string {
  return error instanceof Error && error.message.trim()
    ? redactSecrets(error.message).slice(0, 500)
    : "Meta WhatsApp request failed";
}

async function parseJson(response: Response): Promise<Record<string, unknown> | null> {
  const raw: unknown = await response.json().catch(() => null);
  return raw && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : null;
}

function metaErrorMessage(status: number, body: Record<string, unknown> | null): string {
  const error = body?.error;
  const message =
    error && typeof error === "object" && !Array.isArray(error)
      ? (error as Record<string, unknown>).message
      : null;
  return `Meta WhatsApp request failed with status ${String(status)}${
    typeof message === "string" ? `: ${message}` : ""
  }`;
}

async function requestWithRetry(
  config: MessagingConfig,
  transport: MessagingTransport,
  url: string,
  init: RequestInit
): Promise<Response> {
  for (let attempt = 0; attempt <= config.maxRetries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
    try {
      const response = await transport(url, { ...init, signal: controller.signal });
      clearTimeout(timeout);
      if (![408, 409, 429].includes(response.status) && response.status < 500) return response;
      if (attempt === config.maxRetries) return response;
    } catch {
      clearTimeout(timeout);
      if (attempt === config.maxRetries) break;
    }
    await new Promise((resolve) => {
      setTimeout(resolve, 250 * (attempt + 1));
    });
  }

  throw new Error("Meta WhatsApp request failed after retries");
}

export class NotConfiguredMessagingProvider implements MessagingProvider {
  public constructor(private readonly config: MessagingConfig) {}

  public getHealth(): Promise<MessagingHealthDto> {
    return Promise.resolve({
      ...baseHealth(this.config, "NOT_CONFIGURED"),
      configured: false,
      missingConfig: ["MESSAGING_PROVIDER"],
      lastError: "Messaging provider is not configured"
    });
  }

  public verifyWebhookSignature(): boolean {
    return false;
  }
}

export class MetaWhatsAppProvider implements MessagingProvider {
  public constructor(
    private readonly config: MessagingConfig,
    private readonly transport: MessagingTransport = fetch
  ) {}

  public async getHealth(): Promise<MessagingHealthDto> {
    const missing = missingMetaConfig(this.config);
    if (missing.length > 0) {
      return {
        ...baseHealth(this.config, "NOT_CONFIGURED"),
        configured: false,
        missingConfig: missing,
        lastError: `Missing configuration: ${missing.join(", ")}`
      };
    }

    try {
      const response = await requestWithRetry(
        this.config,
        this.transport,
        `${this.config.metaWhatsApp.graphApiBaseUrl.replace(/\/$/, "")}/${encodeURIComponent(
          this.config.metaWhatsApp.phoneNumberId
        )}?fields=id,display_phone_number,verified_name`,
        {
          headers: {
            Authorization: `Bearer ${this.config.metaWhatsApp.accessToken}`
          }
        }
      );
      const body = await parseJson(response);
      if (!response.ok) {
        throw new Error(metaErrorMessage(response.status, body));
      }
      return baseHealth(this.config, "CONFIGURED");
    } catch (error) {
      return {
        ...baseHealth(this.config, "ERROR"),
        configured: true,
        lastError: sanitizeError(error)
      };
    }
  }

  public verifyWebhookSignature(input: {
    rawBody: string;
    signature: string | undefined;
  }): boolean {
    if (!this.config.metaWhatsApp.appSecret || !input.signature?.startsWith("sha256=")) {
      return false;
    }
    const expected = `sha256=${crypto
      .createHmac("sha256", this.config.metaWhatsApp.appSecret)
      .update(input.rawBody)
      .digest("hex")}`;
    const expectedBuffer = Buffer.from(expected);
    const actualBuffer = Buffer.from(input.signature);
    return (
      expectedBuffer.length === actualBuffer.length &&
      crypto.timingSafeEqual(expectedBuffer, actualBuffer)
    );
  }
}

export class TwilioWhatsAppProvider implements MessagingProvider {
  public constructor(
    private readonly config: MessagingConfig,
    private readonly transport: MessagingTransport = fetch
  ) {}

  public async getHealth(): Promise<MessagingHealthDto> {
    const missing = missingTwilioConfig(this.config);
    if (missing.length > 0) {
      return {
        ...baseHealth(this.config, "NOT_CONFIGURED"),
        configured: false,
        missingConfig: missing,
        lastError: `Missing configuration: ${missing.join(", ")}`
      };
    }

    try {
      const response = await requestWithRetry(
        this.config,
        this.transport,
        `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(
          this.config.twilioWhatsApp.accountSid
        )}.json`,
        {
          headers: {
            Authorization: `Basic ${Buffer.from(
              `${this.config.twilioWhatsApp.accountSid}:${this.config.twilioWhatsApp.authToken}`
            ).toString("base64")}`
          }
        }
      );
      const body = await parseJson(response);
      if (!response.ok) {
        throw new Error(metaErrorMessage(response.status, body));
      }
      return baseHealth(this.config, "CONFIGURED");
    } catch (error) {
      return {
        ...baseHealth(this.config, "ERROR"),
        configured: true,
        lastError: sanitizeError(error)
      };
    }
  }

  public verifyWebhookSignature(): boolean {
    return false;
  }

  public verifyTwilioWebhookSignature(input: TwilioWhatsAppSignatureInput): boolean {
    if (!this.config.twilioWhatsApp.authToken || !input.signature) return false;
    const sortedParams = Object.keys(input.params)
      .sort()
      .map((key) => `${key}${input.params[key] ?? ""}`)
      .join("");
    const expected = crypto
      .createHmac("sha1", this.config.twilioWhatsApp.authToken)
      .update(`${input.url}${sortedParams}`)
      .digest("base64");
    const expectedBuffer = Buffer.from(expected);
    const actualBuffer = Buffer.from(input.signature);
    return (
      expectedBuffer.length === actualBuffer.length &&
      crypto.timingSafeEqual(expectedBuffer, actualBuffer)
    );
  }
}

export function createMessagingProvider(
  config: MessagingConfig,
  transport?: MessagingTransport
): MessagingProvider {
  if (config.provider === "meta_whatsapp") return new MetaWhatsAppProvider(config, transport);
  if (config.provider === "twilio_whatsapp") return new TwilioWhatsAppProvider(config, transport);
  return new NotConfiguredMessagingProvider(config);
}
