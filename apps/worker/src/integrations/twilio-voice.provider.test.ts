import { describe, expect, it } from "vitest";
import type { VoiceConfig } from "@shilabs/shared-config";
import { WorkerExotelVoiceProvider } from "./twilio-voice.provider.js";

function buildConfig(overrides: Partial<VoiceConfig> = {}): VoiceConfig {
  return {
    provider: "exotel",
    nodeEnv: "development",
    webhookBaseUrl: "https://voice-e2e.example.test",
    defaultRegion: "IN",
    defaultAccent: "indian-english",
    recordingEnabled: false,
    transcriptionEnabled: false,
    productionCallingEnabled: false,
    complianceConsentMode: "development",
    e2eAllowedToNumbers: ["+917724960195"],
    timeoutMs: 1000,
    maxRetries: 0,
    twilio: {
      accountSid: "",
      authToken: "",
      fromNumber: "",
      statusCallbackPath: "/api/voice/twilio/status",
      recordingCallbackPath: "/api/voice/twilio/recording"
    },
    exotel: {
      accountSid: "exotel-account",
      apiKey: "exotel-key",
      apiToken: "exotel-token",
      apiSubdomain: "api.exotel.test",
      callerId: "09513886363",
      appUrl: "",
      agentNumber: "7724960195",
      statusCallbackPath: "/api/voice/exotel/status",
      voicebotAppPath: "/api/voice/exotel/app",
      voicebotStreamPath: "/api/voice/exotel/stream"
    },
    voiceAi: {
      enabled: false,
      provider: "openai_realtime",
      openaiApiKey: "test-key",
      model: "gpt-4o-realtime-preview-2024-10-01",
      voice: "alloy",
      sampleRate: 24000,
      streamToken: "test-token",
      localVoskModelPath: "",
      localPythonCommand: "",
      localTtsVoiceName: ""
    },
    ...overrides
  };
}

describe("Worker Exotel voice provider", () => {
  it("rejects calls when EXOTEL_AGENT_NUMBER matches the customer destination", async () => {
    const requests: string[] = [];
    const provider = new WorkerExotelVoiceProvider(buildConfig(), (url) => {
      requests.push(url instanceof Request ? url.url : String(url));
      return Promise.resolve(Response.json({ Call: { Sid: "must-not-call" } }));
    });

    const result = await provider.createOutboundCall({
      to: "+917724960195",
      from: "09513886363",
      twimlUrl: "https://voice-e2e.example.test/api/voice/twilio/twiml/test-call?attemptId=1",
      statusCallbackUrl: "https://voice-e2e.example.test/api/voice/exotel/status",
      recordingCallbackUrl: null,
      recordingEnabled: false,
      transcriptionEnabled: false,
      idempotencyKey: "r23-exotel-self-dial"
    });

    expect(result).toMatchObject({
      status: "FAILED",
      providerCallId: null
    });
    expect(result.lastError).toContain("EXOTEL_AGENT_NUMBER must be different");
    expect(requests).toHaveLength(0);
  });
});
