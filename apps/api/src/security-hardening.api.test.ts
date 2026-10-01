import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { redactSecrets } from "./shared/redaction.js";

const originalEnv = { ...process.env };

describe("R29 security hardening", () => {
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("sets security headers on API responses", async () => {
    process.env.API_GLOBAL_RATE_LIMIT_MAX = "1000";
    const app = createApp();

    const response = await request(app).get("/health").expect(200);

    expect(response.header["x-content-type-options"]).toBe("nosniff");
    expect(response.header["x-frame-options"]).toBe("DENY");
    expect(response.header["referrer-policy"]).toBe("no-referrer");
    expect(response.header["permissions-policy"]).toContain("camera=()");
    expect(response.header["cache-control"]).toBe("no-store");
    expect(response.header["x-powered-by"]).toBeUndefined();
  });

  it("enforces configured JSON body limits", async () => {
    process.env.API_JSON_BODY_LIMIT = "64b";
    process.env.API_GLOBAL_RATE_LIMIT_MAX = "1000";
    const app = createApp();

    const response = await request(app)
      .post("/api/auth/login")
      .send({
        email: "large@example.local",
        password: "x".repeat(256)
      })
      .expect(413);

    expect(response.body).toMatchObject({
      error: {
        code: "VALIDATION_ERROR",
        message: "Request body is too large"
      }
    });
  });

  it("does not expose development Twilio test TwiML in production without confirmed consent", async () => {
    process.env.NODE_ENV = "production";
    process.env.VOICE_COMPLIANCE_CONSENT_MODE = "disabled";
    process.env.API_GLOBAL_RATE_LIMIT_MAX = "1000";
    const app = createApp();

    await request(app).get("/api/voice/twilio/twiml/test-call").expect(404);
  });

  it("redacts secret-looking keys and token-looking values", () => {
    expect(
      redactSecrets({
        authToken: "secret-value",
        nested: {
          message: "Provider failed with Bearer abc.def.ghi and sk-testsecret123456"
        }
      })
    ).toEqual({
      authToken: "[REDACTED]",
      nested: {
        message: "Provider failed with [REDACTED] and [REDACTED]"
      }
    });
  });
});
