import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import type { VoiceConfig } from "@shilabs/shared-config";
import { ExotelVoiceProvider, TwilioVoiceProvider, type VoiceTransport } from "./voice.provider.js";

function buildConfig(overrides: Partial<VoiceConfig> = {}): VoiceConfig {
  return {
    provider: "twilio",
    nodeEnv: "development",
    webhookBaseUrl: "https://voice-e2e.example.test",
    defaultRegion: "IN",
    defaultAccent: "indian-english",
    recordingEnabled: false,
    transcriptionEnabled: false,
    productionCallingEnabled: false,
    complianceConsentMode: "development",
    e2eAllowedToNumbers: ["+919876543210"],
    timeoutMs: 1000,
    maxRetries: 0,
    twilio: {
      accountSid: "AC00000000000000000000000000000000",
      authToken: "test-token",
      fromNumber: "+15005550006",
      statusCallbackPath: "/api/voice/twilio/status",
      recordingCallbackPath: "/api/voice/twilio/recording"
    },
    exotel: {
      accountSid: "exotel-account",
      apiKey: "exotel-key",
      apiToken: "exotel-token",
      apiSubdomain: "api.exotel.test",
      callerId: "08000000000",
      appUrl: "https://voice-e2e.example.test/exotel-flow",
      agentNumber: "",
      statusCallbackPath: "/api/voice/exotel/status",
      voicebotAppPath: "/api/voice/exotel/voicebot",
      voicebotStreamPath: "/api/voice/exotel/voicebot/stream"
    },
    voiceAi: {
      enabled: false,
      provider: "openai_realtime",
      openaiApiKey: "",
      model: "gpt-realtime",
      voice: "alloy",
      sampleRate: 16000,
      streamToken: "",
      localVoskModelPath: "",
      localPythonCommand: "python",
      localTtsVoiceName: ""
    },
    ...overrides
  };
}

describe("Twilio voice provider", () => {
  it("creates outbound calls with status callbacks and no recording by default", async () => {
    const requests: { url: string; body: URLSearchParams }[] = [];
    const transport: VoiceTransport = (url, init) => {
      requests.push({
        url: url instanceof Request ? url.url : String(url),
        body: init?.body as URLSearchParams
      });
      return Promise.resolve(Response.json({ sid: "CA123", status: "queued" }));
    };
    const provider = new TwilioVoiceProvider(buildConfig(), transport);

    const result = await provider.createOutboundCall({
      to: "+919876543210",
      from: "+15005550006",
      twimlUrl: "https://voice-e2e.example.test/api/voice/twilio/twiml/test-call?attemptId=1",
      statusCallbackUrl: "https://voice-e2e.example.test/api/voice/twilio/status",
      recordingCallbackUrl: null,
      recordingEnabled: false,
      transcriptionEnabled: false,
      idempotencyKey: "r22-provider-call"
    });

    expect(result).toMatchObject({
      provider: "TWILIO",
      status: "ACCEPTED",
      providerCallId: "CA123"
    });
    expect(requests[0]?.url).toBe(
      "https://api.twilio.com/2010-04-01/Accounts/AC00000000000000000000000000000000/Calls.json"
    );
    expect(requests[0]?.body.get("To")).toBe("+919876543210");
    expect(requests[0]?.body.get("StatusCallbackEvent")).toBe(
      "initiated ringing answered completed"
    );
    expect(requests[0]?.body.has("Record")).toBe(false);
    expect(requests[0]?.body.has("Transcribe")).toBe(false);
  });

  it("verifies Twilio form webhook signatures", () => {
    const config = buildConfig();
    const provider = new TwilioVoiceProvider(config);
    const url = "https://voice-e2e.example.test/api/voice/twilio/status";
    const params = {
      CallSid: "CA123",
      CallStatus: "completed",
      SequenceNumber: "2"
    };
    const sorted = Object.keys(params)
      .sort()
      .map((key) => `${key}${params[key as keyof typeof params]}`)
      .join("");
    const signature = crypto
      .createHmac("sha1", config.twilio.authToken)
      .update(`${url}${sorted}`)
      .digest("base64");

    expect(provider.verifyWebhook({ url, params, signature })).toBe(true);
    expect(provider.verifyWebhook({ url, params, signature: "invalid" })).toBe(false);
  });
});

describe("Exotel voice provider", () => {
  it("checks Exotel health with a real authenticated read endpoint", async () => {
    const requests: { url: string; authorization: string | null }[] = [];
    const transport: VoiceTransport = (url, init) => {
      const headers = new Headers(init?.headers);
      requests.push({
        url: url instanceof Request ? url.url : String(url),
        authorization: headers.get("authorization")
      });
      return Promise.resolve(Response.json({ Calls: [] }));
    };
    const provider = new ExotelVoiceProvider(buildConfig({ provider: "exotel" }), transport);

    const health = await provider.getHealth();

    expect(health).toMatchObject({
      provider: "EXOTEL",
      status: "CONFIGURED",
      configured: true
    });
    expect(requests[0]?.url).toBe("https://api.exotel.test/v1/Accounts/exotel-account/Calls.json?PageSize=1");
    expect(requests[0]?.authorization).toBe(`Basic ${Buffer.from("exotel-key:exotel-token").toString("base64")}`);
  });

  it("creates real Exotel outbound call requests and only accepts provider call IDs", async () => {
    const requests: { url: string; body: URLSearchParams; authorization: string | null }[] = [];
    const transport: VoiceTransport = (url, init) => {
      const headers = new Headers(init?.headers);
      requests.push({
        url: url instanceof Request ? url.url : String(url),
        body: init?.body as URLSearchParams,
        authorization: headers.get("authorization")
      });
      return Promise.resolve(Response.json({ Call: { Sid: "exotel-call-1", Status: "queued" } }));
    };
    const provider = new ExotelVoiceProvider(buildConfig({ provider: "exotel" }), transport);

    const result = await provider.createOutboundCall({
      to: "+919876543210",
      from: "08000000000",
      twimlUrl: "https://voice-e2e.example.test/api/voice/twilio/twiml/test-call?attemptId=1",
      statusCallbackUrl: "https://voice-e2e.example.test/api/voice/exotel/status",
      recordingCallbackUrl: null,
      recordingEnabled: false,
      transcriptionEnabled: false,
      idempotencyKey: "r22-exotel-provider-call"
    });

    expect(result).toMatchObject({
      provider: "EXOTEL",
      status: "ACCEPTED",
      providerCallId: "exotel-call-1",
      providerStatus: "queued"
    });
    expect(requests[0]?.url).toBe("https://api.exotel.test/v1/Accounts/exotel-account/Calls/connect.json");
    expect(requests[0]?.authorization).toBe(`Basic ${Buffer.from("exotel-key:exotel-token").toString("base64")}`);
    expect(requests[0]?.body.get("From")).toBe("+919876543210");
    expect(requests[0]?.body.get("CallerId")).toBe("08000000000");
    expect(requests[0]?.body.get("Url")).toBe("https://voice-e2e.example.test/exotel-flow");
    expect(requests[0]?.body.get("StatusCallback")).toBe("https://voice-e2e.example.test/api/voice/exotel/status");
    expect(requests[0]?.body.get("CustomField")).toBe("r22-exotel-provider-call");
  });

  it("uses Exotel bidirectional stream parameters for direct voice AI calls", async () => {
    const requests: { body: URLSearchParams }[] = [];
    const transport: VoiceTransport = (_url, init) => {
      requests.push({ body: init?.body as URLSearchParams });
      return Promise.resolve(Response.json({ Call: { Sid: "exotel-ai-call-1", Status: "queued" } }));
    };
    const baseConfig = buildConfig();
    const provider = new ExotelVoiceProvider(
      buildConfig({
        provider: "exotel",
        exotel: { ...baseConfig.exotel, appUrl: "" },
        voiceAi: { ...baseConfig.voiceAi, enabled: true, streamToken: "stream-token" }
      }),
      transport
    );

    const result = await provider.createOutboundCall({
      to: "+919876543210",
      from: "08000000000",
      twimlUrl: "https://voice-e2e.example.test/api/voice/twilio/twiml/test-call?attemptId=1",
      statusCallbackUrl: "https://voice-e2e.example.test/api/voice/exotel/status",
      recordingCallbackUrl: null,
      recordingEnabled: false,
      transcriptionEnabled: false,
      idempotencyKey: "r23-exotel-voice-ai-call"
    });

    expect(result).toMatchObject({
      provider: "EXOTEL",
      status: "ACCEPTED",
      providerCallId: "exotel-ai-call-1"
    });
    expect(requests[0]?.body.get("StreamUrl")).toBe(
      "wss://voice-e2e.example.test/api/voice/exotel/voicebot/stream/stream-token?sample-rate=16000"
    );
    expect(requests[0]?.body.get("StreamType")).toBe("bidirectional");
    expect(requests[0]?.body.has("Url")).toBe(false);
    expect(requests[0]?.body.has("CallType")).toBe(false);
  });

  it("rejects Exotel calls when the configured agent number matches the customer destination", async () => {
    const requests: string[] = [];
    const transport: VoiceTransport = (url) => {
      requests.push(url instanceof Request ? url.url : String(url));
      return Promise.resolve(Response.json({ Call: { Sid: "must-not-call" } }));
    };
    const provider = new ExotelVoiceProvider(
      buildConfig({ provider: "exotel", exotel: { ...buildConfig().exotel, agentNumber: "7724960195" } }),
      transport
    );

    const result = await provider.createOutboundCall({
      to: "+917724960195",
      from: "09513886363",
      twimlUrl: "https://voice-e2e.example.test/api/voice/twilio/twiml/test-call?attemptId=1",
      statusCallbackUrl: "https://voice-e2e.example.test/api/voice/exotel/status",
      recordingCallbackUrl: null,
      recordingEnabled: false,
      transcriptionEnabled: false,
      idempotencyKey: "r22-exotel-self-dial"
    });

    expect(result).toMatchObject({
      provider: "EXOTEL",
      status: "FAILED",
      providerCallId: null
    });
    expect(result.lastError).toContain("EXOTEL_AGENT_NUMBER must be different");
    expect(requests).toHaveLength(0);
  });
});
