import { describe, expect, it } from "vitest";
import {
  createExpiringVoiceStreamToken,
  verifyExpiringVoiceStreamToken,
  verifySharedSecret
} from "./index.js";

describe("voice webhook security", () => {
  it("accepts only the configured shared secret", () => {
    expect(verifySharedSecret("configured-secret", "configured-secret")).toBe(true);
    expect(verifySharedSecret("configured-secret", "wrong-secret")).toBe(false);
    expect(verifySharedSecret("", "")).toBe(false);
  });

  it("issues short-lived signed stream credentials without exposing the signing secret", () => {
    const secret = "server-only-stream-signing-secret";
    const token = createExpiringVoiceStreamToken({
      secret,
      ttlSeconds: 60,
      now: new Date("2026-10-06T00:00:00.000Z"),
      nonce: "fixed-nonce"
    });

    expect(token).not.toContain(secret);
    expect(
      verifyExpiringVoiceStreamToken({
        token,
        secret,
        now: new Date("2026-10-06T00:00:30.000Z")
      })
    ).toBe(true);
    expect(
      verifyExpiringVoiceStreamToken({
        token,
        secret,
        now: new Date("2026-10-06T00:01:01.000Z")
      })
    ).toBe(false);
  });
});
