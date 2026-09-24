import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import type { VoiceConfig } from "@shilabs/shared-config";
import { TwilioVoiceProvider, type VoiceTransport } from "./voice.provider.js";

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
