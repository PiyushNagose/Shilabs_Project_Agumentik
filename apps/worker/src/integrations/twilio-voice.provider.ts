import type { VoiceConfig } from "@shilabs/shared-config";

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

function authHeader(config: VoiceConfig): string {
  return `Basic ${Buffer.from(`${config.twilio.accountSid}:${config.twilio.authToken}`).toString(
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
    ? error.message.slice(0, 500)
    : "Twilio Voice request failed";
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

  throw new Error("Twilio Voice request failed after retries");
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
