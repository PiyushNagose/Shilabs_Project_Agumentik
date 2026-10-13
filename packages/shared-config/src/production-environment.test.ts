import { describe, expect, it, vi } from "vitest";
import { assertProductionEnvironment, emitOperationalAlert } from "./index.js";

const validProductionEnv: NodeJS.ProcessEnv = {
  NODE_ENV: "production",
  DATABASE_URL: "postgresql://app:secret@db.internal/shilabs",
  REDIS_URL: "rediss://cache.internal:6380",
  WEB_ORIGIN: "https://crm.example.com",
  WORKER_API_BASE_URL: "https://api.example.com",
  JWT_SECRET: "j".repeat(48),
  REALTIME_INTERNAL_SECRET: "r".repeat(48),
  EMAIL_PROVIDER: "AWS_SES",
  AWS_SES_REGION: "ap-south-1",
  AWS_SES_FROM_EMAIL: "sales@example.com",
  AWS_SES_WEBHOOK_SECRET: "webhook-secret",
  AWS_SES_USE_DEFAULT_CREDENTIAL_CHAIN: "true",
  AI_PROVIDER: "gemini",
  GEMINI_API_KEY: "gemini-secret",
  GEMINI_MODEL: "gemini-model",
  MESSAGING_PROVIDER: "none",
  VOICE_PROVIDER: "none",
  CALENDAR_PROVIDER: "none"
};

describe("production environment validation", () => {
  it("accepts secure production configuration and reports disabled optional providers", () => {
    expect(assertProductionEnvironment(validProductionEnv)).toMatchObject({
      database: "configured",
      redis: "configured",
      providers: {
        email: "AWS_SES",
        ai: "gemini",
        messaging: "none",
        voice: "none",
        calendar: "none",
        zohoBigin: "disabled"
      }
    });
  });

  it("rejects local infrastructure, weak secrets, dev bootstrap, and incomplete providers", () => {
    expect(() =>
      assertProductionEnvironment({
        ...validProductionEnv,
        DATABASE_URL: "postgresql://app:secret@localhost/shilabs",
        JWT_SECRET: "short",
        DEV_ADMIN_PASSWORD: "unsafe",
        MESSAGING_PROVIDER: "meta_whatsapp"
      })
    ).toThrow(
      /DATABASE_URL_LOCALHOST.*DEV_ADMIN_CREDENTIALS_NOT_ALLOWED.*JWT_SECRET_MIN_LENGTH.*MESSAGING_WEBHOOK_BASE_URL/
    );
  });

  it("delivers vendor-neutral alerts without placing secrets in the payload", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);
    await emitOperationalAlert(
      {
        category: "queue_failure",
        severity: "error",
        message: "Job failed",
        correlationId: "correlation-1",
        metadata: { attempts: 3 }
      },
      {
        NODE_ENV: "production",
        OPS_ALERT_WEBHOOK_URL: "https://alerts.example.com/events",
        OPS_ALERT_WEBHOOK_SECRET: "top-secret"
      }
    );
    expect(fetchMock).toHaveBeenCalledOnce();
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(typeof init.body).toBe("string");
    const body = typeof init.body === "string" ? init.body : "";
    expect(body).toContain("correlation-1");
    expect(body).not.toContain("top-secret");
    vi.unstubAllGlobals();
  });
});
