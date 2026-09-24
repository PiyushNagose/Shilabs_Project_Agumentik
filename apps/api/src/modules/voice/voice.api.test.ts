import crypto from "node:crypto";
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { UserRole, UserStatus } from "@prisma/client";
import type { AuthResponse, IntegrationHealthDto, VoiceWebhookResultDto } from "@shilabs/shared-types";
import { createApp } from "../../app.js";
import { prisma } from "../../shared/prisma.js";
import { hashPassword } from "../auth/auth.service.js";

const app = createApp();
const password = "CorrectHorse123!";
const adminEmail = "r22-voice-api-admin@example.local";
const repEmail = "r22-voice-api-rep@example.local";
const webhookBaseUrl = "https://voice-e2e.example.test";
const authToken = "api-test-token";

function setVoiceEnv(): void {
  process.env.VOICE_PROVIDER = "twilio";
  process.env.VOICE_WEBHOOK_BASE_URL = webhookBaseUrl;
  process.env.VOICE_COMPLIANCE_CONSENT_MODE = "development";
  process.env.TWILIO_ACCOUNT_SID = "AC00000000000000000000000000000000";
  process.env.TWILIO_AUTH_TOKEN = authToken;
  process.env.TWILIO_FROM_NUMBER = "+15005550006";
}

async function cleanup(): Promise<void> {
  await prisma.authSession.deleteMany({
    where: { user: { email: { in: [adminEmail, repEmail] } } }
  });
  await prisma.voiceProviderEvent.deleteMany({
    where: { providerEventId: { startsWith: "twilio-status:CAapi" } }
  });
  await prisma.user.deleteMany({ where: { email: { in: [adminEmail, repEmail] } } });
}

async function seedUsers(): Promise<void> {
  const passwordHash = await hashPassword(password);
  await prisma.user.createMany({
    data: [
      {
        email: adminEmail,
        passwordHash,
        firstName: "R22",
        lastName: "Admin",
        role: UserRole.ADMIN,
        status: UserStatus.ACTIVE
      },
      {
        email: repEmail,
        passwordHash,
        firstName: "R22",
        lastName: "Rep",
        role: UserRole.SALES_REP,
        status: UserStatus.ACTIVE
      }
    ]
  });
}

async function login(email: string): Promise<string> {
  const response = await request(app).post("/api/auth/login").send({ email, password }).expect(200);
  return (response.body as AuthResponse).accessToken;
}

function signTwilio(url: string, params: Record<string, string>): string {
  const sorted = Object.keys(params)
    .sort()
    .map((key) => `${key}${params[key] ?? ""}`)
    .join("");
  return crypto.createHmac("sha1", authToken).update(`${url}${sorted}`).digest("base64");
}

describe("R22 voice API", () => {
  beforeEach(async () => {
    setVoiceEnv();
    await cleanup();
  }, 45000);

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  }, 45000);

  it("protects voice health with RBAC", async () => {
    await seedUsers();
    const adminToken = await login(adminEmail);
    const repToken = await login(repEmail);

    await request(app).get("/api/voice/health").expect(401);
    await request(app).get("/api/voice/health").set("Authorization", `Bearer ${repToken}`).expect(403);

    process.env.VOICE_PROVIDER = "none";
    const response = await request(app)
      .get("/api/voice/health")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);
    expect(response.body as IntegrationHealthDto).toMatchObject({
      provider: "TWILIO",
      status: "NOT_CONFIGURED",
      configured: false
    });
  }, 45000);

  it("requires valid Twilio signatures for status webhooks", async () => {
    const body = {
      CallSid: "CAapi123",
      CallStatus: "completed",
      SequenceNumber: "1"
    };

    await request(app)
      .post("/api/voice/twilio/status")
      .type("form")
      .send(body)
      .expect(401);

    const response = await request(app)
      .post("/api/voice/twilio/status")
      .set(
        "X-Twilio-Signature",
        signTwilio(`${webhookBaseUrl}/api/voice/twilio/status`, body)
      )
      .type("form")
      .send(body)
      .expect(200);

    expect(response.body as VoiceWebhookResultDto).toMatchObject({
      provider: "TWILIO",
      status: "PROCESSED",
      eventId: "twilio-status:CAapi123:1",
      callAttemptId: null,
      callStatus: "COMPLETED"
    });
  }, 45000);
});
