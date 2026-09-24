import crypto from "node:crypto";
import type { VoiceConfig } from "@shilabs/shared-config";
import type { VoiceHealthDto } from "@shilabs/shared-types";

export interface VoiceProvider {
  getHealth(): Promise<VoiceHealthDto>;
  createOutboundCall(input: VoiceOutboundCallInput): Promise<VoiceOutboundCallResult>;
  verifyWebhook(input: VoiceWebhookVerificationInput): boolean;
}

export type VoiceTransport = typeof fetch;

export interface VoiceOutboundCallInput {
  to: string;
  from: string;
  twimlUrl: string;
  statusCallbackUrl: string;
  recordingCallbackUrl: string | null;
  recordingEnabled: boolean;
  transcriptionEnabled: boolean;
  idempotencyKey: string;
}

export interface VoiceOutboundCallResult {
  provider: "TWILIO";
  status: "ACCEPTED" | "FAILED" | "NOT_CONFIGURED";
  providerCallId: string | null;
  providerStatus: string | null;
  lastError: string | null;
}

export interface VoiceWebhookVerificationInput {
  url: string;
  params: Record<string, string>;
  signature: string | undefined;
}

function missingTwilioConfig(config: VoiceConfig): string[] {
  const missing: string[] = [];
  if (!config.twilio.accountSid) missing.push("TWILIO_ACCOUNT_SID");
  if (!config.twilio.authToken) missing.push("TWILIO_AUTH_TOKEN");
  if (!config.twilio.fromNumber) missing.push("TWILIO_FROM_NUMBER");
  if (!config.webhookBaseUrl) missing.push("VOICE_WEBHOOK_BASE_URL");
  return missing;
}

function baseHealth(config: VoiceConfig, status: VoiceHealthDto["status"]): VoiceHealthDto {
  return {
    provider: config.provider === "twilio" ? "TWILIO" : "NONE",
    status,
    configured: status === "CONFIGURED",
    checkedAt: new Date().toISOString(),
    missingConfig: [],
    recordingEnabled: config.recordingEnabled,
    transcriptionEnabled: config.transcriptionEnabled,
    productionCallingEnabled: config.productionCallingEnabled,
    complianceConsentMode: config.complianceConsentMode,
    defaultRegion: config.defaultRegion,
    defaultAccent: config.defaultAccent,
    lastError: null
  };
}

function sanitizeError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message.slice(0, 500);
  }

  return "Twilio Voice request failed";
}

function twilioAuthHeader(config: VoiceConfig): string {
  return `Basic ${Buffer.from(`${config.twilio.accountSid}:${config.twilio.authToken}`).toString(
    "base64"
  )}`;
}

async function parseTwilioResponse(response: Response): Promise<Record<string, unknown> | null> {
  const raw: unknown = await response.json().catch(() => null);
  return raw && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : null;
}

function twilioErrorMessage(status: number, body: Record<string, unknown> | null): string {
  const code = typeof body?.code === "number" ? `code ${String(body.code)}` : null;
  const message = typeof body?.message === "string" ? body.message : null;
  const parts = [code, message].filter(Boolean);
  return `Twilio Voice request failed with status ${String(status)}${
    parts.length ? `: ${parts.join("; ")}` : ""
  }`;
}

async function requestWithRetry(
  config: VoiceConfig,
  transport: VoiceTransport,
  url: string,
  init: RequestInit
): Promise<Response> {
  for (let attempt = 0; attempt <= config.maxRetries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
    try {
      const response = await transport(url, { ...init, signal: controller.signal });
      clearTimeout(timeout);
      if (![408, 409, 429].includes(response.status) && response.status < 500) {
        return response;
      }
      if (attempt === config.maxRetries) {
        return response;
      }
    } catch {
      clearTimeout(timeout);
      if (attempt === config.maxRetries) break;
    }
    await new Promise((resolve) => {
      setTimeout(resolve, 250 * (attempt + 1));
    });
  }

  throw new Error("Twilio Voice request failed after retries");
}

export class NotConfiguredVoiceProvider implements VoiceProvider {
  public constructor(private readonly config: VoiceConfig) {}

  public getHealth(): Promise<VoiceHealthDto> {
    return Promise.resolve({
      ...baseHealth(this.config, "NOT_CONFIGURED"),
      configured: false,
      missingConfig: ["VOICE_PROVIDER"],
      lastError: "Voice provider is not configured"
    });
  }

  public createOutboundCall(): Promise<VoiceOutboundCallResult> {
    return Promise.resolve({
      provider: "TWILIO",
      status: "NOT_CONFIGURED",
      providerCallId: null,
      providerStatus: null,
      lastError: "Voice provider is not configured"
    });
  }

  public verifyWebhook(): boolean {
    return false;
  }
}

export class TwilioVoiceProvider implements VoiceProvider {
  public constructor(
    private readonly config: VoiceConfig,
    private readonly transport: VoiceTransport = fetch
  ) {}

  public async getHealth(): Promise<VoiceHealthDto> {
    const missingConfig = missingTwilioConfig(this.config);
    if (missingConfig.length > 0) {
      return {
        ...baseHealth(this.config, "NOT_CONFIGURED"),
        configured: false,
        missingConfig,
        lastError: `Missing configuration: ${missingConfig.join(", ")}`
      };
    }

    try {
      const response = await requestWithRetry(
        this.config,
        this.transport,
        `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(
          this.config.twilio.accountSid
        )}.json`,
        { headers: { Authorization: twilioAuthHeader(this.config) } }
      );
      const body = await parseTwilioResponse(response);
      if (!response.ok) {
        throw new Error(twilioErrorMessage(response.status, body));
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

  public async createOutboundCall(
    input: VoiceOutboundCallInput
  ): Promise<VoiceOutboundCallResult> {
    const missingConfig = missingTwilioConfig(this.config);
    if (missingConfig.length > 0) {
      return {
        provider: "TWILIO",
        status: "NOT_CONFIGURED",
        providerCallId: null,
        providerStatus: null,
        lastError: `Missing configuration: ${missingConfig.join(", ")}`
      };
    }

    try {
      const body = new URLSearchParams({
        To: input.to,
        From: input.from,
        Url: input.twimlUrl,
        StatusCallback: input.statusCallbackUrl,
        StatusCallbackMethod: "POST",
        StatusCallbackEvent: "initiated ringing answered completed"
      });
      if (input.recordingEnabled) {
        body.set("Record", "true");
        if (input.recordingCallbackUrl) {
          body.set("RecordingStatusCallback", input.recordingCallbackUrl);
          body.set("RecordingStatusCallbackMethod", "POST");
        }
        body.set("Transcribe", input.transcriptionEnabled ? "true" : "false");
      }

      const response = await requestWithRetry(
        this.config,
        this.transport,
        `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(
          this.config.twilio.accountSid
        )}/Calls.json`,
        {
          method: "POST",
          headers: {
            Authorization: twilioAuthHeader(this.config),
            "Content-Type": "application/x-www-form-urlencoded"
          },
          body
        }
      );
      const rawBody = await parseTwilioResponse(response);
      if (!response.ok) {
        throw new Error(twilioErrorMessage(response.status, rawBody));
      }
      const sid = rawBody?.sid;
      if (typeof sid !== "string") {
        throw new Error("Twilio call creation response was malformed");
      }

      return {
        provider: "TWILIO",
        status: "ACCEPTED",
        providerCallId: sid,
        providerStatus: typeof rawBody?.status === "string" ? rawBody.status : null,
        lastError: null
      };
    } catch (error) {
      return {
        provider: "TWILIO",
        status: "FAILED",
        providerCallId: null,
        providerStatus: null,
        lastError: sanitizeError(error)
      };
    }
  }

  public verifyWebhook(input: VoiceWebhookVerificationInput): boolean {
    if (!input.signature || !this.config.twilio.authToken) {
      return false;
    }

    const sortedParams = Object.keys(input.params)
      .sort()
      .map((key) => `${key}${input.params[key] ?? ""}`)
      .join("");
    const expected = crypto
      .createHmac("sha1", this.config.twilio.authToken)
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

export function createVoiceProvider(config: VoiceConfig): VoiceProvider {
  if (config.provider === "none") {
    return new NotConfiguredVoiceProvider(config);
  }
  return new TwilioVoiceProvider(config);
}
