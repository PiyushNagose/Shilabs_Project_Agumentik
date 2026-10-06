import {
  addExotelWebhookCredential,
  createExpiringVoiceStreamToken,
  type VoiceConfig
} from "@shilabs/shared-config";
import { redactSecrets } from "../shared/redaction.js";

export interface WorkerVoiceProvider {
  createOutboundCall(input: {
    to: string;
    from: string;
    twimlUrl: string;
    statusCallbackUrl: string;
    recordingCallbackUrl: string | null;
    recordingEnabled: boolean;
    transcriptionEnabled: boolean;
    idempotencyKey: string;
  }): Promise<{
    status: "ACCEPTED" | "FAILED" | "NOT_CONFIGURED";
    providerCallId: string | null;
    providerStatus: string | null;
    lastError: string | null;
  }>;
}

type VoiceTransport = typeof fetch;

function missingTwilioConfig(config: VoiceConfig): string[] {
  const missing: string[] = [];
  if (config.provider !== "twilio") missing.push("VOICE_PROVIDER");
  if (!config.twilio.accountSid) missing.push("TWILIO_ACCOUNT_SID");
  if (!config.twilio.authToken) missing.push("TWILIO_AUTH_TOKEN");
  if (!config.twilio.fromNumber) missing.push("TWILIO_FROM_NUMBER");
  if (!config.webhookBaseUrl) missing.push("VOICE_WEBHOOK_BASE_URL");
  return missing;
}

function missingExotelConfig(config: VoiceConfig): string[] {
  const missing: string[] = [];
  if (config.provider !== "exotel") missing.push("VOICE_PROVIDER");
  if (!config.exotel.accountSid) missing.push("EXOTEL_ACCOUNT_SID");
  if (!config.exotel.apiKey) missing.push("EXOTEL_API_KEY");
  if (!config.exotel.apiToken) missing.push("EXOTEL_API_TOKEN");
  if (!config.exotel.apiSubdomain) missing.push("EXOTEL_API_SUBDOMAIN");
  if (!config.exotel.callerId) missing.push("EXOTEL_CALLER_ID");
  if (!config.exotel.appUrl && !config.exotel.agentNumber && !config.voiceAi.enabled) {
    missing.push("EXOTEL_APP_URL_OR_AGENT_NUMBER_OR_VOICE_AI_ENABLED");
  }
  if (config.voiceAi.enabled && !config.voiceAi.streamToken) missing.push("VOICE_AI_STREAM_TOKEN");
  if (!config.exotel.webhookSecret) missing.push("EXOTEL_WEBHOOK_SECRET");
  if (!config.webhookBaseUrl) missing.push("VOICE_WEBHOOK_BASE_URL");
  return missing;
}

function authHeader(config: VoiceConfig): string {
  return `Basic ${Buffer.from(`${config.twilio.accountSid}:${config.twilio.authToken}`).toString(
    "base64"
  )}`;
}

function exotelAuthHeader(config: VoiceConfig): string {
  return `Basic ${Buffer.from(`${config.exotel.apiKey}:${config.exotel.apiToken}`).toString(
    "base64"
  )}`;
}

async function parseJson(response: Response): Promise<Record<string, unknown> | null> {
  const raw: unknown = await response.json().catch(() => null);
  return raw && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : null;
}

function errorMessage(status: number, body: Record<string, unknown> | null): string {
  const code = typeof body?.code === "number" ? `code ${String(body.code)}` : null;
  const message = typeof body?.message === "string" ? body.message : null;
  const parts = [code, message].filter(Boolean);
  return `Twilio Voice request failed with status ${String(status)}${
    parts.length ? `: ${parts.join("; ")}` : ""
  }`;
}

function sanitizeError(error: unknown): string {
  return error instanceof Error && error.message.trim()
    ? redactSecrets(error.message).slice(0, 500)
    : "Voice provider request failed";
}

function exotelApiBaseUrl(config: VoiceConfig): string {
  const subdomain = config.exotel.apiSubdomain.replace(/^https?:\/\//iu, "").replace(/\/$/u, "");
  return `https://${subdomain}`;
}

function exotelVoiceAiStreamUrl(config: VoiceConfig): string {
  const base = config.webhookBaseUrl
    .replace(/\/$/u, "")
    .replace(/^http:/u, "ws:")
    .replace(/^https:/u, "wss:");
  const credential = createExpiringVoiceStreamToken({
    secret: config.voiceAi.streamToken,
    ttlSeconds: config.voiceAi.streamTokenTtlSeconds
  });
  const streamPath = `${config.exotel.voicebotStreamPath.replace(/\/$/u, "")}/${encodeURIComponent(credential)}`;
  return `${base}${streamPath}?sample-rate=${String(config.voiceAi.sampleRate)}`;
}

function exotelAppUrl(config: VoiceConfig): string {
  const appUrl = config.exotel.appUrl;
  const internalVoicebotUrl = `${config.webhookBaseUrl.replace(/\/$/u, "")}${config.exotel.voicebotAppPath}`;
  try {
    const app = new URL(appUrl);
    const internal = new URL(internalVoicebotUrl);
    if (app.origin === internal.origin && app.pathname === internal.pathname) {
      return addExotelWebhookCredential(appUrl, config.exotel.webhookSecret);
    }
  } catch {
    return appUrl;
  }
  return appUrl;
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

  throw new Error("Voice provider request failed after retries");
}

export class WorkerTwilioVoiceProvider implements WorkerVoiceProvider {
  public constructor(
    private readonly config: VoiceConfig,
    private readonly transport: VoiceTransport = fetch
  ) {}

  public async createOutboundCall(input: Parameters<WorkerVoiceProvider["createOutboundCall"]>[0]) {
    const missing = missingTwilioConfig(this.config);
    if (missing.length > 0) {
      return {
        status: "NOT_CONFIGURED" as const,
        providerCallId: null,
        providerStatus: null,
        lastError: `Missing configuration: ${missing.join(", ")}`
      };
    }

    try {
      const body = new URLSearchParams({
        To: input.to,
        From: input.from,
        Url: input.twimlUrl,
        StatusCallback: addExotelWebhookCredential(
          input.statusCallbackUrl,
          this.config.exotel.webhookSecret
        ),
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
            Authorization: authHeader(this.config),
            "Content-Type": "application/x-www-form-urlencoded"
          },
          body
        }
      );
      const rawBody = await parseJson(response);
      if (!response.ok) {
        throw new Error(errorMessage(response.status, rawBody));
      }
      const sid = rawBody?.sid;
      if (typeof sid !== "string") {
        throw new Error("Twilio call creation response was malformed");
      }
      return {
        status: "ACCEPTED" as const,
        providerCallId: sid,
        providerStatus: typeof rawBody?.status === "string" ? rawBody.status : null,
        lastError: null
      };
    } catch (error) {
      return {
        status: "FAILED" as const,
        providerCallId: null,
        providerStatus: null,
        lastError: sanitizeError(error)
      };
    }
  }
}

export class WorkerExotelVoiceProvider implements WorkerVoiceProvider {
  public constructor(
    private readonly config: VoiceConfig,
    private readonly transport: VoiceTransport = fetch
  ) {}

  public async createOutboundCall(input: Parameters<WorkerVoiceProvider["createOutboundCall"]>[0]) {
    const missing = missingExotelConfig(this.config);
    if (missing.length > 0) {
      return {
        status: "NOT_CONFIGURED" as const,
        providerCallId: null,
        providerStatus: null,
        lastError: `Missing configuration: ${missing.join(", ")}`
      };
    }

    try {
      const body = new URLSearchParams({
        From: input.to,
        CallerId: input.from,
        CallType: "trans",
        StatusCallback: addExotelWebhookCredential(
          input.statusCallbackUrl,
          this.config.exotel.webhookSecret
        ),
        CustomField: input.idempotencyKey
      });
      if (this.config.exotel.agentNumber) {
        if (isSameDialableNumber(this.config.exotel.agentNumber, input.to)) {
          throw new Error("EXOTEL_AGENT_NUMBER must be different from the customer destination");
        }
        body.set("To", this.config.exotel.agentNumber);
      } else if (this.config.voiceAi.enabled) {
        body.set("StreamUrl", exotelVoiceAiStreamUrl(this.config));
        body.set("StreamType", "bidirectional");
      } else {
        body.set("Url", exotelAppUrl(this.config));
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
      const rawBody = await parseJson(response);
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
        status: "ACCEPTED" as const,
        providerCallId: sid,
        providerStatus: typeof status === "string" ? status : "queued",
        lastError: null
      };
    } catch (error) {
      return {
        status: "FAILED" as const,
        providerCallId: null,
        providerStatus: null,
        lastError: sanitizeError(error)
      };
    }
  }
}
