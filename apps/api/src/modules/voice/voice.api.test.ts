import crypto from "node:crypto";
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { UserRole, UserStatus } from "@prisma/client";
import type {
  AuthResponse,
  IntegrationHealthDto,
  VoiceWebhookResultDto
} from "@shilabs/shared-types";
import { createApp } from "../../app.js";
import { prisma } from "../../shared/prisma.js";
import { hashPassword } from "../auth/auth.service.js";

const app = createApp();
const password = "CorrectHorse123!";
const adminEmail = "r22-voice-api-admin@example.local";
const repEmail = "r22-voice-api-rep@example.local";
const companyPrefix = "R22 Voice API";
const webhookBaseUrl = "https://voice-e2e.example.test";
const authToken = "api-test-token";
const exotelWebhookSecret = "api-test-exotel-webhook-secret";

function setVoiceEnv(): void {
  process.env.VOICE_PROVIDER = "twilio";
  process.env.VOICE_WEBHOOK_BASE_URL = webhookBaseUrl;
  process.env.VOICE_COMPLIANCE_CONSENT_MODE = "development";
  process.env.TWILIO_ACCOUNT_SID = "AC00000000000000000000000000000000";
  process.env.TWILIO_AUTH_TOKEN = authToken;
  process.env.TWILIO_FROM_NUMBER = "+15005550006";
  process.env.EXOTEL_WEBHOOK_SECRET = exotelWebhookSecret;
}

async function cleanup(): Promise<void> {
  await prisma.authSession.deleteMany({
    where: { user: { email: { in: [adminEmail, repEmail] } } }
  });
  await prisma.voiceProviderEvent.deleteMany({
    where: {
      OR: [
        { providerEventId: { startsWith: "twilio-status:CAapi" } },
        { providerEventId: { startsWith: "exotel-status:exotel-api" } }
      ]
    }
  });
  await prisma.domainEventOutbox.deleteMany({
    where: { aggregateType: "VoiceCallAttempt" }
  });
  await prisma.callingAttempt.deleteMany({
    where: { lead: { company: { name: { startsWith: companyPrefix } } } }
  });
  await prisma.callingSequence.deleteMany({
    where: { lead: { company: { name: { startsWith: companyPrefix } } } }
  });
  await prisma.voiceCallAttempt.deleteMany({
    where: { lead: { company: { name: { startsWith: companyPrefix } } } }
  });
  await prisma.activity.deleteMany({
    where: { lead: { company: { name: { startsWith: companyPrefix } } } }
  });
  await prisma.auditEvent.deleteMany({
    where: { entityType: "VoiceCallAttempt" }
  });
  await prisma.lead.deleteMany({
    where: { company: { name: { startsWith: companyPrefix } } }
  });
  await prisma.contact.deleteMany({
    where: { company: { name: { startsWith: companyPrefix } } }
  });
  await prisma.company.deleteMany({
    where: { name: { startsWith: companyPrefix } }
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
    await request(app)
      .get("/api/voice/health")
      .set("Authorization", `Bearer ${repToken}`)
      .expect(403);

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

    await request(app).post("/api/voice/twilio/status").type("form").send(body).expect(401);

    const response = await request(app)
      .post("/api/voice/twilio/status")
      .set("X-Twilio-Signature", signTwilio(`${webhookBaseUrl}/api/voice/twilio/status`, body))
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

  it("ingests Exotel status callbacks and updates persisted call state", async () => {
    const stage = await prisma.pipelineStage.findUniqueOrThrow({ where: { key: "NEW" } });
    const company = await prisma.company.create({
      data: { name: `${companyPrefix} Exotel` }
    });
    const contact = await prisma.contact.create({
      data: {
        companyId: company.id,
        firstName: "Exotel",
        lastName: "Callback",
        email: "exotel-callback@example.local",
        normalizedEmail: "exotel-callback@example.local",
        phone: "+917724960195",
        normalizedPhone: "+917724960195"
      }
    });
    const lead = await prisma.lead.create({
      data: {
        companyId: company.id,
        contactId: contact.id,
        stageId: stage.id,
        source: "r22-voice-api-test"
      }
    });
    const callingSequence = await prisma.callingSequence.create({
      data: {
        leadId: lead.id,
        contactId: contact.id,
        cadenceOffsets: [0, 240, 4320],
        maxAttempts: 3,
        idempotencyKey: `api-exotel-calling-sequence:${lead.id}`
      }
    });
    const voiceCall = await prisma.voiceCallAttempt.create({
      data: {
        leadId: lead.id,
        contactId: contact.id,
        provider: "EXOTEL",
        toPhone: "+917724960195",
        normalizedToPhone: "+917724960195",
        fromPhone: "09513886363",
        providerCallId: "exotel-api-status-1",
        status: "QUEUED",
        idempotencyKey: `api-exotel-voice-call:${lead.id}`
      }
    });
    const callingAttempt = await prisma.callingAttempt.create({
      data: {
        sequenceId: callingSequence.id,
        leadId: lead.id,
        contactId: contact.id,
        attemptIndex: 0,
        status: "ACCEPTED",
        scheduledAt: new Date(),
        voiceCallAttemptId: voiceCall.id,
        idempotencyKey: `api-exotel-calling-attempt:${lead.id}`
      }
    });
    await prisma.callingAttempt.create({
      data: {
        sequenceId: callingSequence.id,
        leadId: lead.id,
        contactId: contact.id,
        attemptIndex: 1,
        status: "SCHEDULED",
        scheduledAt: new Date("2026-10-01T12:00:00.000Z"),
        idempotencyKey: `api-exotel-calling-attempt-next:${lead.id}`
      }
    });

    const response = await request(app)
      .post(`/api/voice/exotel/status?exotel_auth=${encodeURIComponent(exotelWebhookSecret)}`)
      .type("form")
      .send({
        CallSid: "exotel-api-status-1",
        CallStatus: "failed",
        Duration: "29",
        CustomField: "api-exotel-callback"
      })
      .expect(200);

    expect(response.body as VoiceWebhookResultDto).toMatchObject({
      provider: "EXOTEL",
      status: "PROCESSED",
      callAttemptId: voiceCall.id,
      callStatus: "FAILED"
    });
    await expect(
      prisma.voiceCallAttempt.findUniqueOrThrow({ where: { id: voiceCall.id } })
    ).resolves.toMatchObject({
      status: "FAILED",
      durationSeconds: 29,
      failureCode: "EXOTEL_FAILED",
      failureMessage: "Exotel call status: failed"
    });
    await expect(
      prisma.callingAttempt.findUniqueOrThrow({ where: { id: callingAttempt.id } })
    ).resolves.toMatchObject({
      status: "FAILED",
      failureCode: "EXOTEL_FAILED"
    });
    await expect(prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).resolves.toMatchObject({
      nextAction: "Call lead again",
      nextActionAt: new Date("2026-10-01T12:00:00.000Z")
    });

    const answeredResponse = await request(app)
      .post("/api/voice/exotel/status")
      .set("X-Shilabs-Exotel-Secret", exotelWebhookSecret)
      .field("CallSid", "exotel-api-status-1")
      .field("Status", "answered")
      .field("DateUpdated", "2026-09-30 11:41:38")
      .expect(200);
    expect(answeredResponse.body as VoiceWebhookResultDto).toMatchObject({
      provider: "EXOTEL",
      status: "PROCESSED",
      callAttemptId: voiceCall.id,
      callStatus: "IN_PROGRESS"
    });

    const multipartResponse = await request(app)
      .post("/api/voice/exotel/status")
      .set("X-Shilabs-Exotel-Secret", exotelWebhookSecret)
      .field("CallSid", "exotel-api-status-1")
      .field("Status", "completed")
      .field("Duration", "30")
      .field("DateUpdated", "2026-09-30 11:41:39")
      .expect(200);
    expect(multipartResponse.body as VoiceWebhookResultDto).toMatchObject({
      provider: "EXOTEL",
      status: "PROCESSED",
      callAttemptId: voiceCall.id,
      callStatus: "COMPLETED"
    });

    const duplicate = await request(app)
      .post("/api/voice/exotel/status")
      .set("X-Shilabs-Exotel-Secret", exotelWebhookSecret)
      .type("form")
      .send({
        CallSid: "exotel-api-status-1",
        CallStatus: "failed",
        Duration: "29",
        CustomField: "api-exotel-callback"
      })
      .expect(200);
    expect(duplicate.body as VoiceWebhookResultDto).toMatchObject({
      provider: "EXOTEL",
      status: "DUPLICATE",
      callAttemptId: voiceCall.id
    });
  }, 45000);

  it("rejects unauthenticated Exotel callbacks and voicebot bootstrap requests", async () => {
    await request(app)
      .post("/api/voice/exotel/status")
      .type("form")
      .send({ CallSid: "exotel-api-unauthorized", CallStatus: "completed" })
      .expect(401);

    await request(app).get("/api/voice/exotel/voicebot").expect(401);
  });
});
