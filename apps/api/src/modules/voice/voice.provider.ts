import crypto from "node:crypto";
import type { VoiceConfig } from "@shilabs/shared-config";
import type { VoiceHealthDto } from "@shilabs/shared-types";
import { redactSecrets } from "../../shared/redaction.js";

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
  provider: "TWILIO" | "EXOTEL";
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

function missingExotelConfig(config: VoiceConfig): string[] {
  const missing: string[] = [];
  if (!config.exotel.accountSid) missing.push("EXOTEL_ACCOUNT_SID");
  if (!config.exotel.apiKey) missing.push("EXOTEL_API_KEY");
  if (!config.exotel.apiToken) missing.push("EXOTEL_API_TOKEN");
  if (!config.exotel.apiSubdomain) missing.push("EXOTEL_API_SUBDOMAIN");
  if (!config.exotel.callerId) missing.push("EXOTEL_CALLER_ID");
  if (!config.exotel.appUrl && !config.exotel.agentNumber && !config.voiceAi.enabled) {
    missing.push("EXOTEL_APP_URL_OR_AGENT_NUMBER_OR_VOICE_AI_ENABLED");
  }
  if (config.voiceAi.enabled && !config.voiceAi.streamToken) {
    missing.push("VOICE_AI_STREAM_TOKEN");
  }
  if (!config.webhookBaseUrl) missing.push("VOICE_WEBHOOK_BASE_URL");
  return missing;
}

function baseHealth(config: VoiceConfig, status: VoiceHealthDto["status"]): VoiceHealthDto {
  return {
    provider: config.provider === "twilio" ? "TWILIO" : config.provider === "exotel" ? "EXOTEL" : "NONE",
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
    return redactSecrets(error.message).slice(0, 500);
  }

  return "Voice provider request failed";
}

function twilioAuthHeader(config: VoiceConfig): string {
  return `Basic ${Buffer.from(`${config.twilio.accountSid}:${config.twilio.authToken}`).toString(
    "base64"
  )}`;
}

function exotelAuthHeader(config: VoiceConfig): string {
  return `Basic ${Buffer.from(`${config.exotel.apiKey}:${config.exotel.apiToken}`).toString(
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

function exotelApiBaseUrl(config: VoiceConfig): string {
  const subdomain = config.exotel.apiSubdomain.replace(/^https?:\/\//iu, "").replace(/\/$/u, "");
  return `https://${subdomain}`;
}

function exotelVoiceAiStreamUrl(config: VoiceConfig): string {
  const base = config.webhookBaseUrl.replace(/\/$/u, "").replace(/^http:/u, "ws:").replace(/^https:/u, "wss:");
  const streamPath = `${config.exotel.voicebotStreamPath.replace(/\/$/u, "")}/${encodeURIComponent(
    config.voiceAi.streamToken
  )}`;
  const params = new URLSearchParams({
    "sample-rate": String(config.voiceAi.sampleRate)
  });
  return `${base}${streamPath}?${params.toString()}`;
}

function exotelCallPayload(body: Record<string, unknown> | null): Record<string, unknown> | null {
  const call = body?.Call;
  if (call && typeof call === "object" && !Array.isArray(call)) {
    return call as Record<string, unknown>;
  }
  return body;
}

function exotelErrorMessage(status: number, body: Record<string, unknown> | null): string {
  const message =
    typeof body?.Message === "string"
      ? body.Message
      : typeof body?.message === "string"
        ? body.message
        : null;
  return `Exotel Voice request failed with status ${String(status)}${
    message ? `: ${message}` : ""
  }`;
}

function comparableDialableNumber(phone: string): string {
  const digits = phone.replace(/\D/gu, "");
  if (digits.length === 12 && digits.startsWith("91")) return digits.slice(2);
  if (digits.length === 11 && digits.startsWith("0")) return digits.slice(1);
  return digits;
}

function isSameDialableNumber(left: string, right: string): boolean {
  const normalizedLeft = comparableDialableNumber(left);
  const normalizedRight = comparableDialableNumber(right);
  return (
    normalizedLeft.length >= 10 &&
    normalizedRight.length >= 10 &&
    normalizedLeft === normalizedRight
  );
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

  throw new Error("Voice provider request failed after retries");
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
      provider: this.config.provider === "exotel" ? "EXOTEL" : "TWILIO",
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

export class ExotelVoiceProvider implements VoiceProvider {
  public constructor(
    private readonly config: VoiceConfig,
    private readonly transport: VoiceTransport = fetch
  ) {}

  public async getHealth(): Promise<VoiceHealthDto> {
    const missingConfig = missingExotelConfig(this.config);
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
        `${exotelApiBaseUrl(this.config)}/v1/Accounts/${encodeURIComponent(
          this.config.exotel.accountSid
        )}/Calls.json?PageSize=1`,
        { headers: { Authorization: exotelAuthHeader(this.config) } }
      );
      const body = await parseTwilioResponse(response);
      if (!response.ok) {
        throw new Error(exotelErrorMessage(response.status, body));
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
    const missingConfig = missingExotelConfig(this.config);
    if (missingConfig.length > 0) {
      return {
        provider: "EXOTEL",
        status: "NOT_CONFIGURED",
        providerCallId: null,
        providerStatus: null,
        lastError: `Missing configuration: ${missingConfig.join(", ")}`
      };
    }

    try {
      const body = new URLSearchParams({
        From: input.to,
        CallerId: input.from,
        StatusCallback: input.statusCallbackUrl,
        CustomField: input.idempotencyKey
      });
      if (this.config.exotel.agentNumber) {
        if (isSameDialableNumber(this.config.exotel.agentNumber, input.to)) {
          throw new Error("EXOTEL_AGENT_NUMBER must be different from the customer destination");
        }
        body.set("CallType", "trans");
        body.set("To", this.config.exotel.agentNumber);
      } else if (this.config.voiceAi.enabled) {
        body.set("StreamUrl", exotelVoiceAiStreamUrl(this.config));
        body.set("StreamType", "bidirectional");
      } else {
        body.set("CallType", "trans");
        body.set("Url", this.config.exotel.appUrl);
      }

      const response = await requestWithRetry(
        this.config,
        this.transport,
        `${exotelApiBaseUrl(this.config)}/v1/Accounts/${encodeURIComponent(
          this.config.exotel.accountSid
        )}/Calls/connect.json`,
        {
          method: "POST",
          headers: {
            Authorization: exotelAuthHeader(this.config),
            "Content-Type": "application/x-www-form-urlencoded"
          },
          body
        }
      );
      const rawBody = await parseTwilioResponse(response);
      if (!response.ok) {
        throw new Error(exotelErrorMessage(response.status, rawBody));
      }
      const call = exotelCallPayload(rawBody);
      const sid = call?.Sid ?? call?.sid;
      if (typeof sid !== "string" || sid.trim().length === 0) {
        throw new Error("Exotel call creation response was malformed");
      }
      const status = call?.Status ?? call?.status;

      return {
        provider: "EXOTEL",
        status: "ACCEPTED",
        providerCallId: sid,
        providerStatus: typeof status === "string" ? status : null,
        lastError: null
      };
    } catch (error) {
      return {
        provider: "EXOTEL",
        status: "FAILED",
        providerCallId: null,
        providerStatus: null,
        lastError: sanitizeError(error)
      };
    }
  }

  public verifyWebhook(): boolean {
    return false;
  }
}

export function createVoiceProvider(config: VoiceConfig): VoiceProvider {
  if (config.provider === "none") {
    return new NotConfiguredVoiceProvider(config);
  }
  if (config.provider === "exotel") {
    return new ExotelVoiceProvider(config);
  }
  return new TwilioVoiceProvider(config);
}
