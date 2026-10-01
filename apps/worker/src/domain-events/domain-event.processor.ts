import type { DomainEventOutbox } from "@prisma/client";
import {
  completeDomainEvent,
  getExecutionContext,
  recordDomainEventFailure,
  startDomainEventProcessing
} from "./domain-event.repository.js";
import { followUpDomainEventHandlers } from "../followups/followup-email.handler.js";
import { callingDomainEventHandlers } from "../calling/calling-automation.handler.js";
import { whatsAppDomainEventHandlers } from "../messaging/whatsapp-send.handler.js";
import { PermanentDomainEventError } from "./domain-event.errors.js";
import { publishWorkerRealtimeEvent } from "../realtime/realtime.publisher.js";

const INTERNAL_EVENT_TYPES = new Set([
  "REPLY_UNDERSTOOD",
  "NEGOTIATION_DETECTED",
  "NEGOTIATION_HANDOFF_CREATED",
  "REPLY_PROCESSING_FAILED",
  "MESSAGE_RECEIVED",
  "WHATSAPP_SENT",
  "WHATSAPP_STATUS_UPDATED",
  "WHATSAPP_DELIVERY_FAILED",
  "AGENT_CORRECTION_RECORDED",
  "CALL_REQUESTED",
  "CALL_STATUS_UPDATED",
  "CALL_FAILED",
  "VOICE_CONVERSATION_COMPLETED"
]);

const COMMUNICATION_SIDE_EFFECT_EVENTS = new Set([
  "EMAIL_SEND_REQUESTED",
  "FOLLOWUP_DUE",
  "CALL_REQUESTED",
  "WHATSAPP_SEND_REQUESTED",
  "PROPOSAL_SEND_REQUESTED",
  "MEETING_CONFIRMATION_SEND_REQUESTED"
]);

export interface DomainEventHandler {
  handle(event: DomainEventOutbox): Promise<void>;
}

export type DomainEventHandlerMap = Partial<Record<string, DomainEventHandler>>;

export function calculateBackoffMs(attempts: number): number {
  const baseMs = 60_000;
  const cappedAttempt = Math.min(Math.max(attempts, 1), 6);
  return baseMs * 2 ** (cappedAttempt - 1);
}

async function assertExecutionEligible(event: DomainEventOutbox): Promise<void> {
  if (!COMMUNICATION_SIDE_EFFECT_EVENTS.has(event.eventType)) return;

  const context = await getExecutionContext({ event });
  if (!context.lead) {
    throw new PermanentDomainEventError(
      "LEAD_CONTEXT_MISSING",
      "Communication event cannot execute without a current lead context"
    );
  }
  if (["WON", "LOST", "DISQUALIFIED"].includes(context.lead.status)) {
    throw new PermanentDomainEventError(
      "TERMINAL_LEAD_STATE",
      "Communication blocked because lead is in a terminal state"
    );
  }
  if (context.lead.contact.doNotContact) {
    throw new PermanentDomainEventError(
      "DO_NOT_CONTACT",
      "Communication blocked because contact is marked doNotContact"
    );
  }
  if (context.suppressedEmail) {
    throw new PermanentDomainEventError(
      "EMAIL_SUPPRESSED",
      "Communication blocked because contact email is suppressed"
    );
  }
  if (context.conversation && ["HUMAN", "PAUSED"].includes(context.conversation.mode)) {
    throw new PermanentDomainEventError(
      "AUTOMATION_PAUSED",
      "Communication blocked because conversation is paused or under human takeover"
    );
  }
  if (context.activeHumanTakeover) {
    throw new PermanentDomainEventError(
      "HUMAN_TAKEOVER_ACTIVE",
      "Communication blocked because human takeover is active"
    );
  }
}

async function processEvent(event: DomainEventOutbox, handlers: DomainEventHandlerMap): Promise<void> {
  await assertExecutionEligible(event);
  const handler = handlers[event.eventType];
  if (handler) {
    await handler.handle(event);
    return;
  }
  if (INTERNAL_EVENT_TYPES.has(event.eventType)) {
    return;
  }
  throw new PermanentDomainEventError(
    "UNSUPPORTED_DOMAIN_EVENT",
    `No worker handler is registered for ${event.eventType}`
  );
}

export async function processDomainEventJob(input: {
  eventId: string;
  queueJobId: string;
  workerId: string;
  handlers?: DomainEventHandlerMap;
  now?: Date;
}): Promise<"PROCESSED" | "SKIPPED"> {
  const now = input.now ?? new Date();
  const event = await startDomainEventProcessing({
    eventId: input.eventId,
    queueJobId: input.queueJobId,
    workerId: input.workerId,
    now
  });
  if (!event) return "SKIPPED";

  try {
    await processEvent(event, input.handlers ?? {
      ...followUpDomainEventHandlers,
      ...callingDomainEventHandlers,
      ...whatsAppDomainEventHandlers
    });
    await completeDomainEvent({ eventId: event.id, workerId: input.workerId, now: new Date() });
    await publishWorkerRealtimeEvent({
      event,
      action: "domain-event-processed",
      env: process.env
    });
    return "PROCESSED";
  } catch (error) {
    const permanent = error instanceof PermanentDomainEventError;
    const code = permanent ? error.code : "WORKER_PROCESSING_FAILED";
    const message = error instanceof Error ? error.message : "Domain event processing failed";
    const retryAt = new Date(Date.now() + calculateBackoffMs(event.attempts));
    await recordDomainEventFailure({
      event,
      code,
      message,
      retryAt,
      now: new Date(),
      permanent
    });
    await publishWorkerRealtimeEvent({
      event,
      action: "domain-event-failed",
      entityType: "operations",
      env: process.env
    });
    throw error;
  }
}
