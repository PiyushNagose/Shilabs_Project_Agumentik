import crypto from "node:crypto";
import { describe, expect, it, beforeEach, afterAll } from "vitest";
import { workerPrisma } from "../domain-events/domain-event.repository.js";
import type { WorkerVoiceProvider } from "../integrations/twilio-voice.provider.js";
import type { TimelineSyncer, TimelineSyncResult } from "../followups/zoho-timeline.syncer.js";
import {
  executeCallingAutomationAttempt,
  scheduleCallingSequenceAfterFailedEmailSequence
} from "./calling-automation.service.js";

class TestVoiceProvider implements WorkerVoiceProvider {
  public calls: Parameters<WorkerVoiceProvider["createOutboundCall"]>[0][] = [];

  public constructor(
    private readonly result: Awaited<ReturnType<WorkerVoiceProvider["createOutboundCall"]>>
  ) {}

  public createOutboundCall(input: Parameters<WorkerVoiceProvider["createOutboundCall"]>[0]) {
    this.calls.push(input);
    return Promise.resolve(this.result);
  }
}

class TestTimelineSyncer implements TimelineSyncer {
  public calls: string[] = [];

  public constructor(private readonly result: TimelineSyncResult = { status: "SYNCED", externalRecordId: "zoho-note-1", lastError: null }) {}

  public syncActivity(input: { activityId: string }) {
    this.calls.push(input.activityId);
    return Promise.resolve(this.result);
  }
}

const env = {
  NODE_ENV: "development",
  VOICE_PROVIDER: "twilio",
  VOICE_WEBHOOK_BASE_URL: "https://voice-e2e.example.test",
  VOICE_COMPLIANCE_CONSENT_MODE: "development",
  VOICE_RECORDING_ENABLED: "false",
  VOICE_TRANSCRIPTION_ENABLED: "false",
  VOICE_E2E_ALLOWED_TO_NUMBERS: "+15551234567",
  TWILIO_ACCOUNT_SID: "ACtest",
  TWILIO_AUTH_TOKEN: "secret",
  TWILIO_FROM_NUMBER: "+15557654321",
  CALLING_AUTOMATION_ATTEMPTS_SAME_DAY: "2",
  CALLING_AUTOMATION_SAME_DAY_SPACING_MINUTES: "60",
  CALLING_AUTOMATION_WAIT_DAYS_AFTER_SAME_DAY: "3",
  CALLING_AUTOMATION_MAX_ATTEMPTS: "3"
} as NodeJS.ProcessEnv;

async function clean(): Promise<void> {
  await workerPrisma.domainEventOutbox.deleteMany({
    where: {
      OR: [
        { idempotencyKey: { startsWith: "domain-event:calling-attempt:" } },
        { idempotencyKey: { startsWith: "domain-event:calling-attempt-accepted:" } }
      ]
    }
  });
  await workerPrisma.externalRecordMapping.deleteMany({
    where: {
      OR: [
        { provider: "TWILIO", externalRecordId: { startsWith: "CA-r23-" } },
        { provider: "TWILIO", externalRecordId: "CA-should-not-call" },
        { provider: "EXOTEL", externalRecordId: { startsWith: "exotel-r23-" } },
        { provider: "ZOHO_BIGIN", externalRecordId: { startsWith: "zoho-note-" } }
      ]
    }
  });
  await workerPrisma.voiceProviderEvent.deleteMany({ where: { callAttempt: { lead: { source: "r23-calling-test" } } } });
  await workerPrisma.callingAttempt.deleteMany({ where: { lead: { source: "r23-calling-test" } } });
  await workerPrisma.callingSequence.deleteMany({ where: { lead: { source: "r23-calling-test" } } });
  await workerPrisma.voiceCallAttempt.deleteMany({ where: { lead: { source: "r23-calling-test" } } });
  await workerPrisma.followUpAttempt.deleteMany({ where: { lead: { source: "r23-calling-test" } } });
  await workerPrisma.followUpSequence.deleteMany({ where: { lead: { source: "r23-calling-test" } } });
  await workerPrisma.inboundEmail.deleteMany({ where: { lead: { source: "r23-calling-test" } } });
  await workerPrisma.conversation.deleteMany({ where: { lead: { source: "r23-calling-test" } } });
  await workerPrisma.activity.deleteMany({ where: { lead: { source: "r23-calling-test" } } });
  await workerPrisma.auditEvent.deleteMany({
    where: { entityType: { in: ["CallingSequence", "CallingAttempt"] } }
  });
  await workerPrisma.lead.deleteMany({ where: { source: "r23-calling-test" } });
  await workerPrisma.contact.deleteMany({ where: { source: "r23-calling-test" } });
  await workerPrisma.company.deleteMany({ where: { name: { startsWith: "R23 Calling" } } });
}

async function createCompletedFollowUp() {
  const stage = await workerPrisma.pipelineStage.findFirstOrThrow({ where: { key: "NEW" } });
  const company = await workerPrisma.company.create({
    data: { name: `R23 Calling ${crypto.randomUUID()}` }
  });
  const contact = await workerPrisma.contact.create({
    data: {
      companyId: company.id,
      firstName: "R23",
      lastName: "Caller",
      email: "r23-calling@example.local",
      normalizedEmail: "r23-calling@example.local",
      phone: "+15551234567",
      normalizedPhone: "+15551234567",
      source: "r23-calling-test"
    }
  });
  const lead = await workerPrisma.lead.create({
    data: {
      companyId: company.id,
      contactId: contact.id,
      stageId: stage.id,
      source: "r23-calling-test"
    }
  });
  const sequence = await workerPrisma.followUpSequence.create({
    data: {
      leadId: lead.id,
      contactId: contact.id,
      status: "COMPLETED",
      cadenceDays: [0, 1, 5, 9],
      currentStep: 4,
      completedAt: new Date(),
      idempotencyKey: `r23-followup:${lead.id}`
    }
  });
  await Promise.all(
    [0, 1, 2, 3].map((index) =>
      workerPrisma.followUpAttempt.create({
        data: {
          sequenceId: sequence.id,
          leadId: lead.id,
          stepIndex: index,
          kind: index === 0 ? "FIRST_EMAIL" : "FOLLOW_UP",
          status: "SENT",
          scheduledAt: new Date(),
          subject: `R23 ${String(index)}`,
          textBody: "No reply follow-up",
          idempotencyKey: `r23-followup-attempt:${sequence.id}:${String(index)}`,
          sentAt: new Date()
        }
      })
    )
  );
  return { lead, contact, sequence };
}

beforeEach(async () => {
  await clean();
});

afterAll(async () => {
  await clean();
  await workerPrisma.$disconnect();
});

describe("R23 calling automation", () => {
  it("schedules two same-day attempts and one attempt after three days", async () => {
    const { sequence } = await createCompletedFollowUp();
    const now = new Date("2026-09-23T09:00:00.000Z");

    await scheduleCallingSequenceAfterFailedEmailSequence({
      followUpSequenceId: sequence.id,
      env,
      now
    });
    await scheduleCallingSequenceAfterFailedEmailSequence({
      followUpSequenceId: sequence.id,
      env,
      now
    });

    const calling = await workerPrisma.callingSequence.findUniqueOrThrow({
      where: { idempotencyKey: `calling-sequence:follow-up:${sequence.id}` },
      include: { attempts: { orderBy: { attemptIndex: "asc" } } }
    });
    expect(calling.cadenceOffsets).toEqual([0, 60, 4320]);
    expect(calling.attempts).toHaveLength(3);
    expect(calling.attempts.map((attempt) => attempt.scheduledAt.toISOString())).toEqual([
      "2026-09-23T09:00:00.000Z",
      "2026-09-23T10:00:00.000Z",
      "2026-09-26T09:00:00.000Z"
    ]);
    await expect(
      workerPrisma.domainEventOutbox.count({
        where: {
          aggregateType: "CallingAttempt",
          correlationId: calling.id,
          eventType: "CALL_AUTOMATION_ATTEMPT_DUE"
        }
      })
    ).resolves.toBe(3);
  });

  it("places a provider-confirmed call once and retries Zoho without placing another call", async () => {
    const { sequence } = await createCompletedFollowUp();
    await scheduleCallingSequenceAfterFailedEmailSequence({ followUpSequenceId: sequence.id, env });
    const attempt = await workerPrisma.callingAttempt.findFirstOrThrow({
      where: { sequence: { followUpSequenceId: sequence.id }, attemptIndex: 0 }
    });
    const event = await workerPrisma.domainEventOutbox.findUniqueOrThrow({
      where: { id: attempt.domainEventId ?? "" }
    });
    const provider = new TestVoiceProvider({
      status: "ACCEPTED",
      providerCallId: "CA-r23-accepted",
      providerStatus: "queued",
      lastError: null
    });
    const timeline = new TestTimelineSyncer();

    await executeCallingAutomationAttempt({ event, env, provider, timelineSyncer: timeline });
    await executeCallingAutomationAttempt({ event, env, provider, timelineSyncer: timeline });

    expect(provider.calls).toHaveLength(1);
    const updated = await workerPrisma.callingAttempt.findUniqueOrThrow({ where: { id: attempt.id } });
    expect(updated.status).toBe("ACCEPTED");
    expect(updated.voiceCallAttemptId).toBeTruthy();
    expect(updated.zohoSyncStatus).toBe("SYNCED");
    await expect(
      workerPrisma.externalRecordMapping.count({
        where: { provider: "TWILIO", entityType: "CALL", localEntityId: updated.voiceCallAttemptId ?? "" }
      })
    ).resolves.toBe(1);
  });

  it("uses Exotel behind the existing R23 execution path when configured", async () => {
    const exotelEnv = {
      ...env,
      VOICE_PROVIDER: "exotel",
      EXOTEL_ACCOUNT_SID: "exotel-account",
      EXOTEL_API_KEY: "exotel-key",
      EXOTEL_API_TOKEN: "exotel-token",
      EXOTEL_API_SUBDOMAIN: "api.exotel.test",
      EXOTEL_CALLER_ID: "08000000000",
      EXOTEL_APP_URL: "https://voice-e2e.example.test/exotel-flow"
    } as NodeJS.ProcessEnv;
    const { sequence } = await createCompletedFollowUp();
    await scheduleCallingSequenceAfterFailedEmailSequence({ followUpSequenceId: sequence.id, env: exotelEnv });
    const attempt = await workerPrisma.callingAttempt.findFirstOrThrow({
      where: { sequence: { followUpSequenceId: sequence.id }, attemptIndex: 0 }
    });
    const event = await workerPrisma.domainEventOutbox.findUniqueOrThrow({
      where: { id: attempt.domainEventId ?? "" }
    });
    const provider = new TestVoiceProvider({
      status: "ACCEPTED",
      providerCallId: "exotel-r23-accepted",
      providerStatus: "queued",
      lastError: null
    });
    const timeline = new TestTimelineSyncer();

    await executeCallingAutomationAttempt({ event, env: exotelEnv, provider, timelineSyncer: timeline });

    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0]).toMatchObject({
      to: "+15551234567",
      from: "08000000000",
      statusCallbackUrl: "https://voice-e2e.example.test/api/voice/exotel/status"
    });
    const updated = await workerPrisma.callingAttempt.findUniqueOrThrow({
      where: { id: attempt.id },
      include: { voiceCallAttempt: true }
    });
    expect(updated.status).toBe("ACCEPTED");
    expect(updated.voiceCallAttempt?.provider).toBe("EXOTEL");
    expect(updated.voiceCallAttempt?.providerCallId).toBe("exotel-r23-accepted");
    await expect(
      workerPrisma.externalRecordMapping.count({
        where: { provider: "EXOTEL", entityType: "CALL", localEntityId: updated.voiceCallAttemptId ?? "" }
      })
    ).resolves.toBe(1);
  }, 90000);

  it("blocks execution-time ineligible contacts without calling the provider", async () => {
    const { contact, sequence } = await createCompletedFollowUp();
    await workerPrisma.contact.update({ where: { id: contact.id }, data: { doNotContact: true } });
    await scheduleCallingSequenceAfterFailedEmailSequence({ followUpSequenceId: sequence.id, env });
    const attempt = await workerPrisma.callingAttempt.findFirstOrThrow({
      where: { sequence: { followUpSequenceId: sequence.id }, attemptIndex: 0 }
    });
    const event = await workerPrisma.domainEventOutbox.findUniqueOrThrow({
      where: { id: attempt.domainEventId ?? "" }
    });
    const provider = new TestVoiceProvider({
      status: "ACCEPTED",
      providerCallId: "CA-should-not-call",
      providerStatus: "queued",
      lastError: null
    });

    await expect(executeCallingAutomationAttempt({ event, env, provider })).rejects.toThrow(
      "Contact is marked do-not-contact"
    );

    expect(provider.calls).toHaveLength(0);
    await expect(workerPrisma.callingAttempt.findUniqueOrThrow({ where: { id: attempt.id } })).resolves.toMatchObject({
      status: "BLOCKED",
      failureCode: "CONTACT_DO_NOT_CONTACT"
    });
  });
});
