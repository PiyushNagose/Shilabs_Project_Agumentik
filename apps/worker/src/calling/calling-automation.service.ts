import { AgentType, type DomainEventOutbox, type Prisma } from "@prisma/client";
import {
  getCallingAutomationConfig,
  getVoiceConfig,
  type CallingAutomationConfig,
  type VoiceConfig
} from "@shilabs/shared-config";
import { PermanentDomainEventError } from "../domain-events/domain-event.errors.js";
import { workerPrisma } from "../domain-events/domain-event.repository.js";
import { assertWorkspaceIntegrationEnabled } from "../integrations/integration-guard.js";
import {
  WorkerExotelVoiceProvider,
  WorkerTwilioVoiceProvider,
  type WorkerVoiceProvider
} from "../integrations/twilio-voice.provider.js";
import { ZohoTimelineSyncer, type TimelineSyncer } from "../followups/zoho-timeline.syncer.js";
import { normalizeAutomationPhone } from "../shared/automation-phone.js";
import { isAgentCapabilityActive } from "../shared/agent-control.js";
import { hasProspectInboundAfter } from "../shared/prospect-inbound.js";
import { deferChannelAttemptForPromise, recordPreferredFollowUpAccepted, resolvePreferredFollowUpChannel } from "../followups/preferred-followup.service.js";

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

function providerName(config: VoiceConfig): "TWILIO" | "EXOTEL" {
  return config.provider === "exotel" ? "EXOTEL" : "TWILIO";
}

function providerDisplayName(config: VoiceConfig): "Twilio" | "Exotel" {
  return config.provider === "exotel" ? "Exotel" : "Twilio";
}

function providerFromNumber(config: VoiceConfig): string {
  return config.provider === "exotel" ? config.exotel.callerId : config.twilio.fromNumber;
}

function providerCallStatus(
  status: string | null
): "QUEUED" | "RINGING" | "IN_PROGRESS" | "FAILED" {
  const normalized = (status ?? "queued").trim().toLowerCase();
  if (["queued", "initiated", "in-progress", "active"].includes(normalized)) return "QUEUED";
  if (normalized === "ringing") return "RINGING";
  if (["answered", "completed"].includes(normalized)) return "IN_PROGRESS";
  return twilioCallStatus(status);
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
  if (config.provider === "none") {
    missing.push("VOICE_PROVIDER");
  } else if (config.provider === "twilio") {
    if (!config.twilio.accountSid) missing.push("TWILIO_ACCOUNT_SID");
    if (!config.twilio.authToken) missing.push("TWILIO_AUTH_TOKEN");
    if (!config.twilio.fromNumber) missing.push("TWILIO_FROM_NUMBER");
  } else {
    if (!config.exotel.accountSid) missing.push("EXOTEL_ACCOUNT_SID");
    if (!config.exotel.apiKey) missing.push("EXOTEL_API_KEY");
    if (!config.exotel.apiToken) missing.push("EXOTEL_API_TOKEN");
    if (!config.exotel.apiSubdomain) missing.push("EXOTEL_API_SUBDOMAIN");
    if (!config.exotel.callerId) missing.push("EXOTEL_CALLER_ID");
    if (!config.exotel.appUrl && !config.exotel.agentNumber) {
      missing.push("EXOTEL_APP_URL_OR_AGENT_NUMBER");
    }
  }
  if (!config.webhookBaseUrl) missing.push("VOICE_WEBHOOK_BASE_URL");
  return missing;
}

function createConfiguredVoiceProvider(config: VoiceConfig): WorkerVoiceProvider {
  return config.provider === "exotel"
    ? new WorkerExotelVoiceProvider(config)
    : new WorkerTwilioVoiceProvider(config);
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
  if (!sequence.workspaceId) {
    throw new Error("Follow-up sequence has no persisted workspace");
  }
  if (sequence.status !== "COMPLETED") return;
  if (sequence.attempts.some((attempt) => attempt.status !== "SENT")) return;

  if (await hasProspectInboundAfter({ leadId: sequence.leadId, since: sequence.createdAt })) return;

  const idempotencyKey = `calling-sequence:follow-up:${sequence.id}`;
  const existing = await workerPrisma.callingSequence.findUnique({ where: { idempotencyKey } });
  if (existing) return;

  const now = new Date(Math.max((input.now ?? new Date()).getTime(), sequence.lead.nextActionAt?.getTime() ?? 0));
  const offsets = callingOffsets(config);
  await workerPrisma.$transaction(
    async (tx) => {
      const callingSequence = await tx.callingSequence.create({
        data: {
          workspaceId: sequence.workspaceId,
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
            workspaceId: sequence.workspaceId,
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
            workspaceId: sequence.workspaceId,
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
          workspaceId: sequence.workspaceId,
          leadId: sequence.leadId,
          type: "CALL_REQUESTED",
          description: "Calling automation scheduled after completed email follow-up sequence"
        }
      });
      await tx.auditEvent.create({
        data: {
          workspaceId: sequence.workspaceId,
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
      await tx.lead.updateMany({
        where: { id: sequence.leadId, nextActionAt: sequence.lead.nextActionAt, nextAction: sequence.lead.nextAction },
        data: {
          nextAction: sequence.lead.nextAction ?? "Call lead and send WhatsApp follow-up",
          nextActionAt: now
        }
      });
    },
    { maxWait: 10000, timeout: 30000 }
  );
}

async function markAttemptBlocked(input: {
  workspaceId: string;
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
        workspaceId: input.workspaceId,
        leadId: input.leadId,
        type: "CALL_FAILED",
        description: `Calling automation blocked: ${input.message}`
      }
    });
    await tx.auditEvent.create({
      data: {
        workspaceId: input.workspaceId,
        actorType: "SYSTEM",
        entityType: "CallingAttempt",
        entityId: input.attemptId,
        action: "CALLING_ATTEMPT_BLOCKED",
        after: { code: input.code, message: input.message }
      }
    });
    await tx.lead.updateMany({
      where: {
        id: input.leadId,
        OR: [{ nextActionAt: null }, { nextActionAt: { lte: now } }]
      },
      data: {
        nextAction:
          input.sequenceStatus === "ATTENTION_REQUIRED" ? "Review call/WhatsApp automation" : null,
        nextActionAt: null
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
    data: {
      zohoSyncStatus: result.status === "NOT_CONFIGURED" ? "FAILED" : "FAILED",
      zohoLastError: result.lastError
    }
  });
  throw new Error(result.lastError ?? "Zoho timeline sync failed");
}

export async function executeCallingAutomationAttempt(input: {
  event: DomainEventOutbox;
  env?: NodeJS.ProcessEnv;
  provider?: WorkerVoiceProvider;
  timelineSyncer?: TimelineSyncer;
}): Promise<void> {
  const eventWorkspaceId = input.event.workspaceId;
  if (!eventWorkspaceId) {
    throw new PermanentDomainEventError(
      "WORKSPACE_CONTEXT_MISSING",
      "Calling event has no persisted workspace"
    );
  }
  const attemptId = payloadString(input.event, "callingAttemptId");
  if (!attemptId) {
    throw new PermanentDomainEventError("CALLING_ATTEMPT_MISSING", "Calling attempt id missing");
  }

  const attempt = await workerPrisma.callingAttempt.findFirst({
    where: { id: attemptId, sequence: { workspaceId: eventWorkspaceId } },
    include: {
      sequence: { include: { followUpSequence: true } },
      lead: { include: { contact: true, intelligence: true, conversations: true } },
      voiceCallAttempt: true
    }
  });
  if (!attempt) {
    throw new PermanentDomainEventError("CALLING_ATTEMPT_NOT_FOUND", "Calling attempt not found");
  }
  if (attempt.status === "ACCEPTED" && attempt.voiceCallAttempt?.providerCallId) {
    await recordPreferredFollowUpAccepted(input.event);
    if (attempt.activityId)
      await syncAcceptedCallToZoho({
        attemptId,
        activityId: attempt.activityId,
        env: input.env ?? process.env,
        timelineSyncer: input.timelineSyncer
      });
    return;
  }
  if (attempt.status === "COMPLETED" || attempt.status === "SKIPPED") return;
  if (attempt.sequence.status !== "ACTIVE") {
    await markAttemptBlocked({
      workspaceId: eventWorkspaceId,
      attemptId,
      sequenceId: attempt.sequenceId,
      leadId: attempt.leadId,
      status: "SKIPPED",
      sequenceStatus:
        attempt.sequence.status === "ATTENTION_REQUIRED" ? "ATTENTION_REQUIRED" : "STOPPED",
      code: "CALLING_SEQUENCE_NOT_ACTIVE",
      message: `Calling sequence status is ${attempt.sequence.status}`
    });
    return;
  }
  if (!(await isAgentCapabilityActive(eventWorkspaceId, AgentType.VOICE))) {
    await markAttemptBlocked({
      workspaceId: eventWorkspaceId,
      attemptId,
      sequenceId: attempt.sequenceId,
      leadId: attempt.leadId,
      status: "SKIPPED",
      sequenceStatus: "STOPPED",
      code: "AGENT_PAUSED",
      message: "Voice agent is paused"
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
  const inboundAfterSequence = await hasProspectInboundAfter({
    leadId: lead.id,
    since: attempt.sequence.followUpSequence?.createdAt ?? attempt.sequence.createdAt
  });

  const voiceConfig = getVoiceConfig(input.env);
  const normalizedToPhone = normalizeAutomationPhone(
    lead.contact.phone,
    voiceConfig.e2eAllowedToNumbers
  );
  const configuredFromPhone = providerFromNumber(voiceConfig);
  const normalizedFromPhone =
    voiceConfig.provider === "twilio"
      ? normalizeAutomationPhone(configuredFromPhone)
      : configuredFromPhone.trim();
  const preferredChannel = payloadString(input.event, "preferredChannel");
  const controlsBlocked =
    ["OFF", "PAUSED"].includes(lead.intelligence?.aiControlStatus ?? "") ||
    lead.intelligence?.humanInterventionRequired === true ||
    lead.conversations.some((item) => ["HUMAN", "PAUSED", "CLOSED"].includes(item.mode));
  const block: EligibilityBlock | null = controlsBlocked
    ? ["AUTOMATION_PAUSED", "Lead controls block calling", "STOPPED"]
    : preferredChannel &&
        (resolvePreferredFollowUpChannel(lead) !== preferredChannel ||
          attempt.sequence.followUpSequence?.status !== "ACTIVE")
      ? [
          "PREFERRED_CHANNEL_CHANGED",
          "Preferred channel or source follow-up sequence changed",
          "STOPPED"
        ]
      : !normalizedToPhone
        ? ["CONTACT_PHONE_MISSING", "Contact phone is not usable", "ATTENTION_REQUIRED"]
        : !normalizedFromPhone
          ? [
              "VOICE_FROM_PHONE_MISSING",
              `${providerDisplayName(voiceConfig)} from number is not usable`,
              "ATTENTION_REQUIRED"
            ]
          : lead.contact.doNotContact
            ? ["CONTACT_DO_NOT_CONTACT", "Contact is marked do-not-contact", "STOPPED"]
            : ["WON", "LOST", "DISQUALIFIED"].includes(lead.status)
              ? ["TERMINAL_LEAD", `Lead status ${lead.status} forbids calling`, "STOPPED"]
              : lead.automationOwnershipState !== "AI_ACTIVE"
                ? [
                    "AI_OWNERSHIP_INACTIVE",
                    `Lead automation ownership is ${lead.automationOwnershipState}`,
                    "STOPPED"
                  ]
                : conversation && ["HUMAN", "PAUSED", "CLOSED"].includes(conversation.mode)
                  ? [
                      "AUTOMATION_PAUSED",
                      `Conversation mode ${conversation.mode} blocks calling`,
                      "STOPPED"
                    ]
                  : activeTakeover
                    ? [
                        "HUMAN_TAKEOVER_ACTIVE",
                        "Human takeover blocks calling automation",
                        "STOPPED"
                      ]
                    : inboundAfterSequence
                      ? [
                          "INBOUND_REPLY_RECEIVED",
                          "Inbound reply stopped calling automation",
                          "STOPPED"
                        ]
                      : voiceConfig.nodeEnv === "production" &&
                          !voiceConfig.productionCallingEnabled
                        ? [
                            "PRODUCTION_CALLING_DISABLED",
                            "Production voice calling is disabled",
                            "ATTENTION_REQUIRED"
                          ]
                        : voiceConfig.nodeEnv === "production" &&
                            voiceConfig.complianceConsentMode !== "confirmed"
                          ? [
                              "VOICE_CONSENT_NOT_CONFIRMED",
                              "Production calling consent/compliance is not confirmed",
                              "ATTENTION_REQUIRED"
                            ]
                          : voiceConfig.nodeEnv !== "production" &&
                              voiceConfig.e2eAllowedToNumbers.length > 0 &&
                              !voiceConfig.e2eAllowedToNumbers.includes(normalizedToPhone)
                            ? [
                                "E2E_NUMBER_NOT_ALLOWED",
                                "Destination number is not allowed for local E2E voice testing",
                                "ATTENTION_REQUIRED"
                              ]
                            : missingVoiceConfig(voiceConfig).length > 0
                              ? [
                                  "VOICE_NOT_CONFIGURED",
                                  `Missing configuration: ${missingVoiceConfig(voiceConfig).join(", ")}`,
                                  "ATTENTION_REQUIRED"
                                ]
                              : null;

  if (block) {
    await markAttemptBlocked({
      workspaceId: eventWorkspaceId,
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
  const resumingDeferredCall = existingCall?.status === "REQUESTED" &&
    existingCall.failureCode === "VOICE_PROMISE_DEFERRED" && !existingCall.providerCallId;
  if (existingCall && !existingCall.providerCallId && !resumingDeferredCall) {
    const code = existingCall.failureCode ?? "VOICE_PROVIDER_OUTCOME_UNKNOWN";
    const message =
      existingCall.failureMessage ??
      "Existing call has no confirmed provider acceptance; review before retrying";
    await markAttemptBlocked({
      workspaceId: eventWorkspaceId,
      attemptId,
      sequenceId: attempt.sequenceId,
      leadId: lead.id,
      status: "FAILED",
      sequenceStatus: "ATTENTION_REQUIRED",
      code,
      message
    });
    throw new PermanentDomainEventError(code, message);
  }
  let voiceCall = existingCall;
  let activityId = attempt.activityId;

  if (!voiceCall || resumingDeferredCall) {
    if (await deferChannelAttemptForPromise(input.event, attempt.id)) return;
    voiceCall = voiceCall ?? await workerPrisma.voiceCallAttempt.create({
      data: {
        workspaceId: attempt.sequence.workspaceId,
        leadId: lead.id,
        contactId: lead.contactId,
        provider: providerName(voiceConfig),
        toPhone: lead.contact.phone ?? "",
        normalizedToPhone: normalizedToPhone ?? "",
        fromPhone: configuredFromPhone || "not-configured",
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
    if (resumingDeferredCall) {
      const claimed = await workerPrisma.voiceCallAttempt.updateMany({
        where: { id: voiceCall.id, status: "REQUESTED", failureCode: "VOICE_PROMISE_DEFERRED", providerCallId: null },
        data: { status: "PROVIDER_PENDING", failureCode: null }
      });
      if (claimed.count !== 1) return;
    }
    await workerPrisma.callingAttempt.update({
      where: { id: attempt.id },
      data: { status: "CALLING", startedAt: new Date(), voiceCallAttemptId: voiceCall.id }
    });

    const result = await (async () => {
      try {
        await assertWorkspaceIntegrationEnabled({
          workspaceId: eventWorkspaceId,
          provider: voiceConfig.provider === "exotel" ? "EXOTEL" : "TWILIO",
          key: "voice"
        });
        if (await deferChannelAttemptForPromise(input.event, attempt.id, voiceCall.id)) return null;
        const provider = input.provider ?? createConfiguredVoiceProvider(voiceConfig);
        return await provider.createOutboundCall({
          to: normalizedToPhone ?? "",
          from: normalizedFromPhone ?? "",
          twimlUrl: `${voiceConfig.webhookBaseUrl.replace(/\/$/, "")}/api/voice/twilio/twiml/test-call?attemptId=${voiceCall.id}`,
          statusCallbackUrl: webhookUrl(
            voiceConfig,
            voiceConfig.provider === "exotel"
              ? voiceConfig.exotel.statusCallbackPath
              : voiceConfig.twilio.statusCallbackPath
          ),
          recordingCallbackUrl: voiceConfig.recordingEnabled
            ? webhookUrl(voiceConfig, voiceConfig.twilio.recordingCallbackPath)
            : null,
          recordingEnabled: voiceConfig.recordingEnabled,
          transcriptionEnabled: voiceConfig.transcriptionEnabled,
          idempotencyKey: attempt.idempotencyKey
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Voice provider request failed";
        await workerPrisma.voiceCallAttempt.update({
          where: { id: voiceCall.id },
          data: {
            status: "FAILED",
            failureCode: "VOICE_PROVIDER_ERROR",
            failureMessage: message,
            completedAt: new Date()
          }
        });
        await markAttemptBlocked({
          workspaceId: eventWorkspaceId,
          attemptId,
          sequenceId: attempt.sequenceId,
          leadId: lead.id,
          status: "FAILED",
          sequenceStatus: "ATTENTION_REQUIRED",
          code: "VOICE_PROVIDER_ERROR",
          message
        });
        throw error;
      }
    })();

    if (!result) return;

    if (result.status !== "ACCEPTED" || !result.providerCallId) {
      await workerPrisma.voiceCallAttempt.update({
        where: { id: voiceCall.id },
        data: {
          status: result.status === "NOT_CONFIGURED" ? "NOT_CONFIGURED" : "BLOCKED",
          failureCode:
            result.status === "NOT_CONFIGURED" ? "VOICE_NOT_CONFIGURED" : "VOICE_PROVIDER_ERROR",
          failureMessage: result.lastError ?? "Voice provider did not accept the call",
          completedAt: new Date()
        }
      });
      await markAttemptBlocked({
        workspaceId: eventWorkspaceId,
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
          status: providerCallStatus(result.providerStatus),
          providerAcceptedAt: now,
          failureCode: null,
          failureMessage: null
        }
      });
      const activity = await tx.activity.create({
        data: {
          workspaceId: attempt.sequence.workspaceId,
          leadId: lead.id,
          type: "CALL_REQUESTED",
          description: `Calling automation attempt ${String(attempt.attemptIndex + 1)} accepted by ${providerDisplayName(voiceConfig)}`
        }
      });
      await tx.auditEvent.create({
        data: {
          workspaceId: attempt.sequence.workspaceId,
          actorType: "SYSTEM",
          entityType: "CallingAttempt",
          entityId: attempt.id,
          action: "CALLING_ATTEMPT_ACCEPTED",
          after: {
            voiceCallAttemptId: updatedCall.id,
            provider: providerName(voiceConfig),
            providerCallId,
            voicemailPolicy: "UNRESOLVED_OC_01",
            compliancePolicy: "UNRESOLVED_OC_13"
          }
        }
      });
      await tx.externalRecordMapping.upsert({
        where: {
          workspaceId_provider_entityType_localEntityId: {
            workspaceId: eventWorkspaceId,
            provider: providerName(voiceConfig),
            entityType: "CALL",
            localEntityId: updatedCall.id
          }
        },
        create: {
          workspaceId: eventWorkspaceId,
          provider: providerName(voiceConfig),
          entityType: "CALL",
          localEntityId: updatedCall.id,
          externalRecordId: providerCallId,
          syncDirection: "OUTBOUND",
          syncStatus: "SYNCED",
          lastSyncedAt: now,
          idempotencyKey: `${voiceConfig.provider}:call:${updatedCall.id}`
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
        data: {
          currentAttempt: Math.max(attempt.sequence.currentAttempt, attempt.attemptIndex + 1)
        }
      });
      await tx.domainEventOutbox.upsert({
        where: { idempotencyKey: `domain-event:calling-attempt-accepted:${attempt.id}` },
        create: {
          workspaceId: eventWorkspaceId,
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

  await recordPreferredFollowUpAccepted(input.event);
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
