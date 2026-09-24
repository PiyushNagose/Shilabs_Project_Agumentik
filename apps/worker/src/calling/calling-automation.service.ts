import type { DomainEventOutbox, Prisma } from "@prisma/client";
import {
  getCallingAutomationConfig,
  getVoiceConfig,
  type CallingAutomationConfig,
  type VoiceConfig
} from "@shilabs/shared-config";
import { PermanentDomainEventError } from "../domain-events/domain-event.errors.js";
import { workerPrisma } from "../domain-events/domain-event.repository.js";
import { WorkerTwilioVoiceProvider, type WorkerVoiceProvider } from "../integrations/twilio-voice.provider.js";
import { ZohoTimelineSyncer, type TimelineSyncer } from "../followups/zoho-timeline.syncer.js";

type EligibilityBlock = readonly [
  code: string,
  message: string,
  sequenceStatus: "STOPPED" | "ATTENTION_REQUIRED"
];

function payloadString(event: DomainEventOutbox, key: string): string | null {
  const payload = event.payload as Prisma.JsonObject;
  const value = payload[key];
  return typeof value === "string" ? value : null;
}

function normalizePhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const normalized = phone.trim().replace(/[()\s.-]/g, "");
  return /^\+[1-9]\d{7,14}$/u.test(normalized) ? normalized : null;
}

function webhookUrl(config: VoiceConfig, path: string): string {
  return `${config.webhookBaseUrl.replace(/\/$/, "")}${path}`;
}

function twilioCallStatus(status: string | null): "QUEUED" | "RINGING" | "IN_PROGRESS" | "FAILED" {
  const normalized = (status ?? "queued").trim().toLowerCase();
  if (normalized === "ringing") return "RINGING";
  if (normalized === "answered" || normalized === "in-progress") return "IN_PROGRESS";
  if (normalized === "initiated" || normalized === "queued") return "QUEUED";
  return "FAILED";
}

function callingOffsets(config: CallingAutomationConfig): number[] {
  return Array.from({ length: config.maxAttempts }, (_, index) => {
    if (index < config.attemptsSameDay) return index * config.sameDaySpacingMinutes;
    return (
      config.waitDaysAfterSameDay * 24 * 60 +
      (index - config.attemptsSameDay) * config.sameDaySpacingMinutes
    );
  });
}

function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000);
}

function missingVoiceConfig(config: VoiceConfig): string[] {
  const missing: string[] = [];
  if (config.provider !== "twilio") missing.push("VOICE_PROVIDER");
  if (!config.twilio.accountSid) missing.push("TWILIO_ACCOUNT_SID");
  if (!config.twilio.authToken) missing.push("TWILIO_AUTH_TOKEN");
  if (!config.twilio.fromNumber) missing.push("TWILIO_FROM_NUMBER");
  if (!config.webhookBaseUrl) missing.push("VOICE_WEBHOOK_BASE_URL");
  return missing;
}

export async function scheduleCallingSequenceAfterFailedEmailSequence(input: {
  followUpSequenceId: string;
  env?: NodeJS.ProcessEnv;
  now?: Date;
}): Promise<void> {
  const config = getCallingAutomationConfig(input.env);
  if (!config.enabled) return;

  const sequence = await workerPrisma.followUpSequence.findUnique({
    where: { id: input.followUpSequenceId },
    include: { attempts: true, lead: { include: { contact: true } } }
  });
  if (!sequence) return;
  if (sequence.status !== "COMPLETED") return;
  if (sequence.attempts.some((attempt) => attempt.status !== "SENT")) return;

  const inboundAfterSequence = await workerPrisma.inboundEmail.count({
    where: { leadId: sequence.leadId, status: "PROCESSED", receivedAt: { gte: sequence.createdAt } }
  });
  if (inboundAfterSequence > 0) return;

  const idempotencyKey = `calling-sequence:follow-up:${sequence.id}`;
  const existing = await workerPrisma.callingSequence.findUnique({ where: { idempotencyKey } });
  if (existing) return;

  const now = input.now ?? new Date();
  const offsets = callingOffsets(config);
  await workerPrisma.$transaction(async (tx) => {
    const callingSequence = await tx.callingSequence.create({
      data: {
        leadId: sequence.leadId,
        contactId: sequence.contactId,
        followUpSequenceId: sequence.id,
        cadenceOffsets: offsets,
        maxAttempts: offsets.length,
        idempotencyKey
      }
    });

    for (const [index, offset] of offsets.entries()) {
      const scheduledAt = addMinutes(now, offset);
      const attempt = await tx.callingAttempt.create({
        data: {
          sequenceId: callingSequence.id,
          leadId: sequence.leadId,
          contactId: sequence.contactId,
          attemptIndex: index,
          scheduledAt,
          idempotencyKey: `calling-attempt:${callingSequence.id}:${String(index)}`
        }
      });
      const event = await tx.domainEventOutbox.upsert({
        where: { idempotencyKey: `domain-event:calling-attempt:${attempt.id}` },
        create: {
          eventType: "CALL_AUTOMATION_ATTEMPT_DUE",
          aggregateType: "CallingAttempt",
          aggregateId: attempt.id,
          payload: {
            leadId: sequence.leadId,
            contactId: sequence.contactId,
            callingSequenceId: callingSequence.id,
            callingAttemptId: attempt.id,
            followUpSequenceId: sequence.id
          },
          correlationId: callingSequence.id,
          idempotencyKey: `domain-event:calling-attempt:${attempt.id}`,
          nextAttemptAt: scheduledAt,
          maxAttempts: 5
        },
        update: {}
      });
      await tx.callingAttempt.update({
        where: { id: attempt.id },
        data: { domainEventId: event.id }
      });
      await tx.domainEventOutbox.upsert({
        where: { idempotencyKey: `domain-event:whatsapp-send:${attempt.id}` },
        create: {
          eventType: "WHATSAPP_SEND_REQUESTED",
          aggregateType: "CallingAttempt",
          aggregateId: attempt.id,
          payload: {
            leadId: sequence.leadId,
            contactId: sequence.contactId,
            callingSequenceId: callingSequence.id,
            callingAttemptId: attempt.id,
            followUpSequenceId: sequence.id
          },
          correlationId: callingSequence.id,
          idempotencyKey: `domain-event:whatsapp-send:${attempt.id}`,
          nextAttemptAt: scheduledAt,
          maxAttempts: 5
        },
        update: {}
      });
    }

    await tx.activity.create({
      data: {
        leadId: sequence.leadId,
        type: "CALL_REQUESTED",
        description: "Calling automation scheduled after completed email follow-up sequence"
      }
    });
    await tx.auditEvent.create({
      data: {
        actorType: "SYSTEM",
        entityType: "CallingSequence",
        entityId: callingSequence.id,
        action: "CALLING_SEQUENCE_SCHEDULED",
        after: {
          followUpSequenceId: sequence.id,
          cadenceOffsets: offsets,
          voicemailPolicy: "UNRESOLVED_OC_01",
          compliancePolicy: "UNRESOLVED_OC_13"
        }
      }
    });
  });
}

async function markAttemptBlocked(input: {
  attemptId: string;
  sequenceId: string;
  leadId: string;
  status: "BLOCKED" | "FAILED" | "SKIPPED";
  sequenceStatus: "STOPPED" | "ATTENTION_REQUIRED";
  code: string;
  message: string;
}): Promise<void> {
  const now = new Date();
  await workerPrisma.$transaction(async (tx) => {
    await tx.callingAttempt.update({
      where: { id: input.attemptId },
      data: {
        status: input.status,
        completedAt: now,
        failureCode: input.code,
        failureMessage: input.message
      }
    });
    await tx.callingSequence.update({
      where: { id: input.sequenceId },
      data: {
        status: input.sequenceStatus,
        stopReason: input.code,
        stoppedAt: input.sequenceStatus === "STOPPED" ? now : undefined,
        lastErrorCode: input.code,
        lastErrorMessage: input.message
      }
    });
    await tx.activity.create({
      data: {
        leadId: input.leadId,
        type: "CALL_FAILED",
        description: `Calling automation blocked: ${input.message}`
      }
    });
    await tx.auditEvent.create({
      data: {
        actorType: "SYSTEM",
        entityType: "CallingAttempt",
        entityId: input.attemptId,
        action: "CALLING_ATTEMPT_BLOCKED",
        after: { code: input.code, message: input.message }
      }
    });
  });
}

async function syncAcceptedCallToZoho(input: {
  attemptId: string;
  activityId: string;
  env: NodeJS.ProcessEnv;
  timelineSyncer?: TimelineSyncer;
}): Promise<void> {
  const syncer = input.timelineSyncer ?? new ZohoTimelineSyncer(workerPrisma);
  const result = await syncer.syncActivity({ activityId: input.activityId, env: input.env });
  if (result.status === "SYNCED" || result.status === "SKIPPED") {
    await workerPrisma.callingAttempt.update({
      where: { id: input.attemptId },
      data: { zohoSyncStatus: "SYNCED", zohoLastError: null }
    });
    return;
  }

  await workerPrisma.callingAttempt.update({
    where: { id: input.attemptId },
    data: { zohoSyncStatus: result.status === "NOT_CONFIGURED" ? "FAILED" : "FAILED", zohoLastError: result.lastError }
  });
  throw new Error(result.lastError ?? "Zoho timeline sync failed");
}

export async function executeCallingAutomationAttempt(input: {
  event: DomainEventOutbox;
  env?: NodeJS.ProcessEnv;
  provider?: WorkerVoiceProvider;
  timelineSyncer?: TimelineSyncer;
}): Promise<void> {
  const attemptId = payloadString(input.event, "callingAttemptId");
  if (!attemptId) {
    throw new PermanentDomainEventError("CALLING_ATTEMPT_MISSING", "Calling attempt id missing");
  }

  const attempt = await workerPrisma.callingAttempt.findUnique({
    where: { id: attemptId },
    include: {
      sequence: true,
      lead: { include: { contact: true, conversations: { where: { channel: "EMAIL" }, take: 1 } } },
      voiceCallAttempt: true
    }
  });
  if (!attempt) {
    throw new PermanentDomainEventError("CALLING_ATTEMPT_NOT_FOUND", "Calling attempt not found");
  }
  if (attempt.status === "COMPLETED" || attempt.status === "SKIPPED") return;
  if (attempt.sequence.status !== "ACTIVE") {
    await markAttemptBlocked({
      attemptId,
      sequenceId: attempt.sequenceId,
      leadId: attempt.leadId,
      status: "SKIPPED",
      sequenceStatus: attempt.sequence.status === "ATTENTION_REQUIRED" ? "ATTENTION_REQUIRED" : "STOPPED",
      code: "CALLING_SEQUENCE_NOT_ACTIVE",
      message: `Calling sequence status is ${attempt.sequence.status}`
    });
    return;
  }

  const lead = attempt.lead;
  const conversation = lead.conversations[0];
  const activeTakeover = await workerPrisma.humanTakeover.findFirst({
    where: {
      status: "ACTIVE",
      OR: [{ leadId: lead.id }, ...(conversation ? [{ conversationId: conversation.id }] : [])]
    },
    select: { id: true }
  });
  const inboundAfterSequence = await workerPrisma.inboundEmail.count({
    where: { leadId: lead.id, status: "PROCESSED", receivedAt: { gte: attempt.sequence.createdAt } }
  });

  const voiceConfig = getVoiceConfig(input.env);
  const normalizedToPhone = normalizePhone(lead.contact.phone);
  const normalizedFromPhone = normalizePhone(voiceConfig.twilio.fromNumber);
  const block: EligibilityBlock | null = !normalizedToPhone
    ? ["CONTACT_PHONE_MISSING", "Contact phone is not usable", "ATTENTION_REQUIRED"]
    : !normalizedFromPhone
      ? ["VOICE_FROM_PHONE_MISSING", "Twilio from number is not usable", "ATTENTION_REQUIRED"]
      : lead.contact.doNotContact
        ? ["CONTACT_DO_NOT_CONTACT", "Contact is marked do-not-contact", "STOPPED"]
        : ["WON", "LOST", "DISQUALIFIED"].includes(lead.status)
          ? ["TERMINAL_LEAD", `Lead status ${lead.status} forbids calling`, "STOPPED"]
          : conversation && ["HUMAN", "PAUSED", "CLOSED"].includes(conversation.mode)
            ? ["AUTOMATION_PAUSED", `Conversation mode ${conversation.mode} blocks calling`, "STOPPED"]
            : activeTakeover
              ? ["HUMAN_TAKEOVER_ACTIVE", "Human takeover blocks calling automation", "STOPPED"]
              : inboundAfterSequence > 0
                ? ["INBOUND_REPLY_RECEIVED", "Inbound reply stopped calling automation", "STOPPED"]
                : voiceConfig.nodeEnv === "production" && !voiceConfig.productionCallingEnabled
                  ? ["PRODUCTION_CALLING_DISABLED", "Production voice calling is disabled", "ATTENTION_REQUIRED"]
                  : voiceConfig.nodeEnv === "production" && voiceConfig.complianceConsentMode !== "confirmed"
                    ? [
                        "VOICE_CONSENT_NOT_CONFIRMED",
                        "Production calling consent/compliance is not confirmed",
                        "ATTENTION_REQUIRED"
                      ]
                    : voiceConfig.nodeEnv !== "production" &&
                        voiceConfig.e2eAllowedToNumbers.length > 0 &&
                        !voiceConfig.e2eAllowedToNumbers.includes(normalizedToPhone)
                      ? ["E2E_NUMBER_NOT_ALLOWED", "Destination number is not allowed for local E2E voice testing", "ATTENTION_REQUIRED"]
                      : missingVoiceConfig(voiceConfig).length > 0
                        ? [
                            "VOICE_NOT_CONFIGURED",
                            `Missing configuration: ${missingVoiceConfig(voiceConfig).join(", ")}`,
                            "ATTENTION_REQUIRED"
                          ]
                        : null;

  if (block) {
    await markAttemptBlocked({
      attemptId,
      sequenceId: attempt.sequenceId,
      leadId: lead.id,
      status: block[2] === "STOPPED" ? "BLOCKED" : "FAILED",
      sequenceStatus: block[2],
      code: block[0],
      message: block[1]
    });
    throw new PermanentDomainEventError(block[0], block[1]);
  }

  const existingCall = await workerPrisma.voiceCallAttempt.findUnique({
    where: { idempotencyKey: attempt.idempotencyKey }
  });
  let voiceCall = existingCall;
  let activityId = attempt.activityId;

  if (!voiceCall) {
    voiceCall = await workerPrisma.voiceCallAttempt.create({
      data: {
        leadId: lead.id,
        contactId: lead.contactId,
        provider: "TWILIO",
        toPhone: lead.contact.phone ?? "",
        normalizedToPhone: normalizedToPhone ?? "",
        fromPhone: voiceConfig.twilio.fromNumber || "not-configured",
        status: "PROVIDER_PENDING",
        regionalVoice: voiceConfig.defaultRegion,
        accent: voiceConfig.defaultAccent,
        recordingEnabled: voiceConfig.recordingEnabled,
        transcriptionEnabled: voiceConfig.transcriptionEnabled,
        recordingStatus: voiceConfig.recordingEnabled ? "PENDING" : "DISABLED",
        transcriptStatus: voiceConfig.transcriptionEnabled ? "PENDING" : "DISABLED",
        idempotencyKey: attempt.idempotencyKey
      }
    });
    await workerPrisma.callingAttempt.update({
      where: { id: attempt.id },
      data: { status: "CALLING", startedAt: new Date(), voiceCallAttemptId: voiceCall.id }
    });

    const provider = input.provider ?? new WorkerTwilioVoiceProvider(voiceConfig);
    const result = await provider.createOutboundCall({
      to: normalizedToPhone ?? "",
      from: normalizedFromPhone ?? "",
      twimlUrl: `${voiceConfig.webhookBaseUrl.replace(/\/$/, "")}/api/voice/twilio/twiml/test-call?attemptId=${voiceCall.id}`,
      statusCallbackUrl: webhookUrl(voiceConfig, voiceConfig.twilio.statusCallbackPath),
      recordingCallbackUrl: voiceConfig.recordingEnabled
        ? webhookUrl(voiceConfig, voiceConfig.twilio.recordingCallbackPath)
        : null,
      recordingEnabled: voiceConfig.recordingEnabled,
      transcriptionEnabled: voiceConfig.transcriptionEnabled,
      idempotencyKey: attempt.idempotencyKey
    });

    if (result.status !== "ACCEPTED" || !result.providerCallId) {
      await workerPrisma.voiceCallAttempt.update({
        where: { id: voiceCall.id },
        data: {
          status: result.status === "NOT_CONFIGURED" ? "NOT_CONFIGURED" : "BLOCKED",
          failureCode: result.status === "NOT_CONFIGURED" ? "VOICE_NOT_CONFIGURED" : "VOICE_PROVIDER_ERROR",
          failureMessage: result.lastError ?? "Voice provider did not accept the call",
          completedAt: new Date()
        }
      });
      await markAttemptBlocked({
        attemptId,
        sequenceId: attempt.sequenceId,
        leadId: lead.id,
        status: "FAILED",
        sequenceStatus: "ATTENTION_REQUIRED",
        code: result.status === "NOT_CONFIGURED" ? "VOICE_NOT_CONFIGURED" : "VOICE_PROVIDER_ERROR",
        message: result.lastError ?? "Voice provider did not accept the call"
      });
      throw new PermanentDomainEventError(
        result.status === "NOT_CONFIGURED" ? "VOICE_NOT_CONFIGURED" : "VOICE_PROVIDER_ERROR",
        result.lastError ?? "Voice provider did not accept the call"
      );
    }

    const providerCallId = result.providerCallId;
    const voiceCallId = voiceCall.id;
    const now = new Date();
    const saved = await workerPrisma.$transaction(async (tx) => {
      const updatedCall = await tx.voiceCallAttempt.update({
        where: { id: voiceCallId },
        data: {
          providerCallId,
          status: twilioCallStatus(result.providerStatus),
          providerAcceptedAt: now,
          failureCode: null,
          failureMessage: null
        }
      });
      const activity = await tx.activity.create({
        data: {
          leadId: lead.id,
          type: "CALL_REQUESTED",
          description: `Calling automation attempt ${String(attempt.attemptIndex + 1)} accepted by Twilio`
        }
      });
      await tx.auditEvent.create({
        data: {
          actorType: "SYSTEM",
          entityType: "CallingAttempt",
          entityId: attempt.id,
          action: "CALLING_ATTEMPT_ACCEPTED",
          after: {
            voiceCallAttemptId: updatedCall.id,
            providerCallId,
            voicemailPolicy: "UNRESOLVED_OC_01",
            compliancePolicy: "UNRESOLVED_OC_13"
          }
        }
      });
      await tx.externalRecordMapping.upsert({
        where: {
          provider_entityType_localEntityId: {
            provider: "TWILIO",
            entityType: "CALL",
            localEntityId: updatedCall.id
          }
        },
        create: {
          provider: "TWILIO",
          entityType: "CALL",
          localEntityId: updatedCall.id,
          externalRecordId: providerCallId,
          syncDirection: "OUTBOUND",
          syncStatus: "SYNCED",
          lastSyncedAt: now,
          idempotencyKey: `twilio:call:${updatedCall.id}`
        },
        update: {
          externalRecordId: providerCallId,
          syncStatus: "SYNCED",
          lastSyncedAt: now,
          lastErrorCode: null,
          lastErrorMessage: null
        }
      });
      await tx.callingAttempt.update({
        where: { id: attempt.id },
        data: {
          status: "ACCEPTED",
          activityId: activity.id,
          voiceCallAttemptId: updatedCall.id,
          failureCode: null,
          failureMessage: null
        }
      });
      await tx.callingSequence.update({
        where: { id: attempt.sequenceId },
        data: { currentAttempt: Math.max(attempt.sequence.currentAttempt, attempt.attemptIndex + 1) }
      });
      await tx.domainEventOutbox.upsert({
        where: { idempotencyKey: `domain-event:calling-attempt-accepted:${attempt.id}` },
        create: {
          eventType: "CALL_REQUESTED",
          aggregateType: "VoiceCallAttempt",
          aggregateId: updatedCall.id,
          payload: { leadId: lead.id, providerCallId, callingAttemptId: attempt.id },
          correlationId: attempt.sequenceId,
          idempotencyKey: `domain-event:calling-attempt-accepted:${attempt.id}`
        },
        update: {}
      });
      return { activityId: activity.id };
    });
    activityId = saved.activityId;
  }

  if (!activityId) {
    const activity = await workerPrisma.activity.findFirst({
      where: { leadId: lead.id, type: "CALL_REQUESTED" },
      orderBy: { createdAt: "desc" }
    });
    activityId = activity?.id ?? null;
  }
  if (activityId) {
    await syncAcceptedCallToZoho({
      attemptId,
      activityId,
      env: input.env ?? process.env,
      timelineSyncer: input.timelineSyncer
    });
  }
}
