import type { MessagingConfig } from "@shilabs/shared-config";
import { redactSecrets } from "../shared/redaction.js";

export interface WorkerMessagingProvider {
  sendTemplateMessage(input: {
    to: string;
    templateName: string;
    templateLanguage: string;
    idempotencyKey: string;
  }): Promise<{
    status: "ACCEPTED" | "FAILED" | "NOT_CONFIGURED";
    providerMessageId: string | null;
    providerStatus: string | null;
    lastError: string | null;
  }>;
}

type MessagingTransport = typeof fetch;

function missingMetaConfig(config: MessagingConfig): string[] {
  const missing: string[] = [];
  if (config.provider !== "meta_whatsapp") missing.push("MESSAGING_PROVIDER");
  if (!config.metaWhatsApp.accessToken) missing.push("WHATSAPP_ACCESS_TOKEN");
  if (!config.metaWhatsApp.phoneNumberId) missing.push("WHATSAPP_PHONE_NUMBER_ID");
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

async function parseJson(response: Response): Promise<Record<string, unknown> | null> {
  const raw: unknown = await response.json().catch(() => null);
  return raw && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : null;
}

function errorMessage(status: number, body: Record<string, unknown> | null): string {
  const error = body?.error;
  const metaMessage =
    error && typeof error === "object" && !Array.isArray(error)
      ? (error as Record<string, unknown>).message
      : null;
  return `Meta WhatsApp request failed with status ${String(status)}${
    typeof metaMessage === "string" ? `: ${metaMessage}` : ""
  }`;
}

function sanitizeError(error: unknown): string {
  return error instanceof Error && error.message.trim()
    ? redactSecrets(error.message).slice(0, 500)
    : "Meta WhatsApp request failed";
}

function twilioWhatsAppAddress(value: string): string {
  return value.toLowerCase().startsWith("whatsapp:") ? value : `whatsapp:${value}`;
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

export class WorkerMetaWhatsAppProvider implements WorkerMessagingProvider {
  public constructor(
    private readonly config: MessagingConfig,
    private readonly transport: MessagingTransport = fetch
  ) {}

  public async sendTemplateMessage(input: Parameters<WorkerMessagingProvider["sendTemplateMessage"]>[0]) {
    const missing = missingMetaConfig(this.config);
    if (missing.length > 0) {
      return {
        status: "NOT_CONFIGURED" as const,
        providerMessageId: null,
        providerStatus: null,
        lastError: `Missing configuration: ${missing.join(", ")}`
      };
    }

    try {
      const response = await requestWithRetry(
        this.config,
        this.transport,
        `${this.config.metaWhatsApp.graphApiBaseUrl.replace(/\/$/, "")}/${encodeURIComponent(
          this.config.metaWhatsApp.phoneNumberId
        )}/messages`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.config.metaWhatsApp.accessToken}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            messaging_product: "whatsapp",
            to: input.to,
            type: "template",
            template: {
              name: input.templateName,
              language: { code: input.templateLanguage }
            }
          })
        }
      );
      const body = await parseJson(response);
      if (!response.ok) {
        throw new Error(errorMessage(response.status, body));
      }
      const messages = Array.isArray(body?.messages) ? body.messages : [];
      const first = messages[0] && typeof messages[0] === "object" ? (messages[0] as Record<string, unknown>) : null;
      const id = typeof first?.id === "string" ? first.id : null;
      if (!id) {
        throw new Error("Meta WhatsApp send response was malformed");
      }
      return {
        status: "ACCEPTED" as const,
        providerMessageId: id,
        providerStatus: "accepted",
        lastError: null
      };
    } catch (error) {
      return {
        status: "FAILED" as const,
        providerMessageId: null,
        providerStatus: null,
        lastError: sanitizeError(error)
      };
    }
  }
}

export class WorkerTwilioWhatsAppProvider implements WorkerMessagingProvider {
  public constructor(
    private readonly config: MessagingConfig,
    private readonly transport: MessagingTransport = fetch
  ) {}

  public async sendTemplateMessage(input: Parameters<WorkerMessagingProvider["sendTemplateMessage"]>[0]) {
    const missing = missingTwilioConfig(this.config);
    if (missing.length > 0) {
      return {
        status: "NOT_CONFIGURED" as const,
        providerMessageId: null,
        providerStatus: null,
        lastError: `Missing configuration: ${missing.join(", ")}`
      };
    }

    try {
      const body = new URLSearchParams({
        From: twilioWhatsAppAddress(this.config.twilioWhatsApp.sandboxFrom),
        To: twilioWhatsAppAddress(input.to),
        Body: this.config.twilioWhatsApp.defaultBody
      });
      const response = await requestWithRetry(
        this.config,
        this.transport,
        `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(
          this.config.twilioWhatsApp.accountSid
        )}/Messages.json`,
        {
          method: "POST",
          headers: {
            Authorization: `Basic ${Buffer.from(
              `${this.config.twilioWhatsApp.accountSid}:${this.config.twilioWhatsApp.authToken}`
            ).toString("base64")}`,
            "Content-Type": "application/x-www-form-urlencoded",
            "Idempotency-Key": input.idempotencyKey
          },
          body
        }
      );
      const rawBody = await parseJson(response);
      if (!response.ok) {
        throw new Error(errorMessage(response.status, rawBody));
      }
      const sid = typeof rawBody?.sid === "string" ? rawBody.sid : null;
      if (!sid) {
        throw new Error("Twilio WhatsApp send response was malformed");
      }
      return {
        status: "ACCEPTED" as const,
        providerMessageId: sid,
        providerStatus: typeof rawBody?.status === "string" ? rawBody.status : "accepted",
        lastError: null
      };
    } catch (error) {
      return {
        status: "FAILED" as const,
        providerMessageId: null,
        providerStatus: null,
        lastError: sanitizeError(error)
      };
    }
  }
}
