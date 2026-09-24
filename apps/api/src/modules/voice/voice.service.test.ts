import crypto from "node:crypto";
import { describe, expect, it, beforeEach, afterAll, vi } from "vitest";
import { UserRole, UserStatus } from "@prisma/client";
import { prisma } from "../../shared/prisma.js";
import type { AuthenticatedUser } from "../auth/auth.types.js";
import type {
  VoiceOutboundCallInput,
  VoiceOutboundCallResult,
  VoiceProvider,
  VoiceWebhookVerificationInput
} from "./voice.provider.js";
import {
  createManualVoiceCall,
  getVoiceHealth,
  ingestTwilioStatusWebhook
} from "./voice.service.js";

const companyPrefix = "R22 Voice Company";

class FakeVoiceProvider implements VoiceProvider {
  public readonly createOutboundCallMock = vi.fn<
    (input: VoiceOutboundCallInput) => Promise<VoiceOutboundCallResult>
  >();

  public readonly verifyWebhookMock = vi.fn<(input: VoiceWebhookVerificationInput) => boolean>();

  public getHealth() {
    return Promise.resolve({
      provider: "TWILIO" as const,
      status: "CONFIGURED" as const,
      configured: true,
      checkedAt: new Date().toISOString(),
      missingConfig: [],
      recordingEnabled: false,
      transcriptionEnabled: false,
      productionCallingEnabled: false,
      complianceConsentMode: "development" as const,
      defaultRegion: "IN",
      defaultAccent: "indian-english",
      lastError: null
    });
  }

  public createOutboundCall(input: VoiceOutboundCallInput) {
    return this.createOutboundCallMock(input);
  }

  public verifyWebhook(input: VoiceWebhookVerificationInput) {
    return this.verifyWebhookMock(input);
  }
}

function testEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "development",
    VOICE_PROVIDER: "twilio",
    VOICE_WEBHOOK_BASE_URL: "https://voice-e2e.example.test",
    VOICE_DEFAULT_REGION: "IN",
    VOICE_DEFAULT_ACCENT: "indian-english",
    VOICE_RECORDING_ENABLED: "false",
    VOICE_TRANSCRIPTION_ENABLED: "false",
    VOICE_PRODUCTION_CALLING_ENABLED: "false",
    VOICE_COMPLIANCE_CONSENT_MODE: "development",
    VOICE_E2E_ALLOWED_TO_NUMBERS: "+919876543210",
    TWILIO_ACCOUNT_SID: "AC00000000000000000000000000000000",
    TWILIO_AUTH_TOKEN: "test-token",
    TWILIO_FROM_NUMBER: "+15005550006",
    ...overrides
  };
}

async function cleanup(): Promise<void> {
  await prisma.voiceProviderEvent.deleteMany({
    where: { callAttempt: { lead: { company: { name: { startsWith: companyPrefix } } } } }
  });
  await prisma.externalRecordMapping.deleteMany({
    where: { provider: "TWILIO", entityType: "CALL" }
  });
  await prisma.domainEventOutbox.deleteMany({
    where: { aggregateType: "VoiceCallAttempt" }
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
  await prisma.user.deleteMany({
    where: { email: { endsWith: "@r22-voice.example.local" } }
  });
}

async function seedLead(input: { doNotContact?: boolean; status?: "OPEN" | "LOST" } = {}) {
  const user = await prisma.user.create({
    data: {
      email: `${crypto.randomUUID()}@r22-voice.example.local`,
      passwordHash: "not-used",
      firstName: "R22",
      lastName: "Admin",
      role: UserRole.ADMIN,
      status: UserStatus.ACTIVE
    }
  });
  const stage = await prisma.pipelineStage.findUniqueOrThrow({ where: { key: "NEW" } });
  const company = await prisma.company.create({
    data: { name: `${companyPrefix} ${crypto.randomUUID()}` }
  });
  const contact = await prisma.contact.create({
    data: {
      companyId: company.id,
      firstName: "R22",
      lastName: "Caller",
      phone: "+91 98765 43210",
      normalizedPhone: "+919876543210",
      email: `${crypto.randomUUID()}@example.local`,
      doNotContact: input.doNotContact ?? false
    }
  });
  const lead = await prisma.lead.create({
    data: {
      companyId: company.id,
      contactId: contact.id,
      ownerId: user.id,
      source: "test",
      stageId: stage.id,
      status: input.status ?? "OPEN"
    }
  });
  const actor: AuthenticatedUser = {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    role: user.role,
    status: user.status,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt
  };
  return { actor, lead };
}

describe("R22 voice provider foundation", () => {
  beforeEach(async () => {
    await cleanup();
  }, 45000);

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  }, 45000);

  it("reports truthful not-configured voice health", async () => {
    const health = await getVoiceHealth({ env: testEnv({ VOICE_PROVIDER: "none" }) });

    expect(health).toMatchObject({
      provider: "TWILIO",
      status: "NOT_CONFIGURED",
      configured: false,
      missingConfig: ["VOICE_PROVIDER"]
    });
  });

  it("persists provider-accepted manual calls with evidence and mapping", async () => {
    const seeded = await seedLead();
    const provider = new FakeVoiceProvider();
    provider.createOutboundCallMock.mockResolvedValue({
      provider: "TWILIO",
      status: "ACCEPTED",
      providerCallId: "CA1234567890",
      providerStatus: "queued",
      lastError: null
    });

    const call = await createManualVoiceCall(
      seeded.actor,
      { leadId: seeded.lead.id, idempotencyKey: "r22-manual-call-success" },
      { env: testEnv(), provider }
    );

    expect(call).toMatchObject({
      leadId: seeded.lead.id,
      provider: "TWILIO",
      providerCallId: "CA1234567890",
      status: "QUEUED",
      recordingEnabled: false,
      transcriptionEnabled: false,
      recordingStatus: "DISABLED",
      transcriptStatus: "DISABLED"
    });
    expect(provider.createOutboundCallMock).toHaveBeenCalledTimes(1);

    const [mappingCount, activityCount, auditCount, eventCount] = await Promise.all([
      prisma.externalRecordMapping.count({
        where: { provider: "TWILIO", entityType: "CALL", localEntityId: call.id }
      }),
      prisma.activity.count({ where: { leadId: seeded.lead.id, type: "CALL_REQUESTED" } }),
      prisma.auditEvent.count({ where: { entityType: "VoiceCallAttempt", entityId: call.id } }),
      prisma.domainEventOutbox.count({
        where: { aggregateType: "VoiceCallAttempt", aggregateId: call.id }
      })
    ]);
    expect(mappingCount).toBe(1);
    expect(activityCount).toBe(1);
    expect(auditCount).toBe(1);
    expect(eventCount).toBe(1);

    const duplicate = await createManualVoiceCall(
      seeded.actor,
      { leadId: seeded.lead.id, idempotencyKey: "r22-manual-call-success" },
      { env: testEnv(), provider }
    );
    expect(duplicate.id).toBe(call.id);
    expect(provider.createOutboundCallMock).toHaveBeenCalledTimes(1);
  }, 45000);

  it("blocks do-not-contact leads before calling the provider", async () => {
    const seeded = await seedLead({ doNotContact: true });
    const provider = new FakeVoiceProvider();

    const call = await createManualVoiceCall(
      seeded.actor,
      { leadId: seeded.lead.id, idempotencyKey: "r22-manual-call-blocked" },
      { env: testEnv(), provider }
    );

    expect(call).toMatchObject({
      status: "BLOCKED",
      failureCode: "CONTACT_DO_NOT_CONTACT"
    });
    expect(provider.createOutboundCallMock).not.toHaveBeenCalled();
  });

  it("ingests signed Twilio status webhooks idempotently", async () => {
    const seeded = await seedLead();
    const provider = new FakeVoiceProvider();
    provider.createOutboundCallMock.mockResolvedValue({
      provider: "TWILIO",
      status: "ACCEPTED",
      providerCallId: "CAstatus123",
      providerStatus: "queued",
      lastError: null
    });
    provider.verifyWebhookMock.mockReturnValue(true);
    const call = await createManualVoiceCall(
      seeded.actor,
      { leadId: seeded.lead.id, idempotencyKey: "r22-manual-call-status" },
      { env: testEnv(), provider }
    );

    const body = {
      CallSid: "CAstatus123",
      CallStatus: "completed",
      CallDuration: "42",
      SequenceNumber: "2"
    };
    const first = await ingestTwilioStatusWebhook({
      body,
      signature: "valid",
      env: testEnv(),
      provider
    });
    const second = await ingestTwilioStatusWebhook({
      body,
      signature: "valid",
      env: testEnv(),
      provider
    });

    expect(first).toMatchObject({
      provider: "TWILIO",
      status: "PROCESSED",
      callAttemptId: call.id,
      callStatus: "COMPLETED"
    });
    expect(second).toMatchObject({
      provider: "TWILIO",
      status: "DUPLICATE",
      callAttemptId: call.id
    });
    const updated = await prisma.voiceCallAttempt.findUniqueOrThrow({ where: { id: call.id } });
    expect(updated.status).toBe("COMPLETED");
    expect(updated.durationSeconds).toBe(42);
    await expect(
      prisma.voiceProviderEvent.count({ where: { providerCallId: "CAstatus123" } })
    ).resolves.toBe(1);
  }, 45000);
});
