import {
  AgentType,
  Prisma,
  UserStatus,
  WorkspaceMemberStatus,
  type User,
  type WorkspaceRole
} from "@prisma/client";
import type { MeetingRequestDto, MeetingSlotDto } from "@shilabs/shared-types";
import { AppError } from "../../shared/errors.js";
import { prisma } from "../../shared/prisma.js";
import { toPublicUser } from "../auth/auth.service.js";
import { assertAgentCapabilityActive } from "../agents/agent.service.js";
import type { AuthenticatedUser } from "../auth/auth.types.js";
import { isWorkspaceManager } from "../authorization/workspace-permissions.js";
import { getCalendarAvailability, resolveWorkspaceCalendarConfig } from "../calendar/calendar.service.js";
import { createCalendarProvider } from "../calendar/calendar.provider.js";
import { getCalendarConfig } from "@shilabs/shared-config";
import { publishDomainEvent } from "../domain-events/domain-events.service.js";
import { toLeadDto } from "../leads/lead.service.js";
import { completeHumanAction } from "../leads/lead-automation-ownership.service.js";
import { autoStartLeadAiAutomation } from "../followups/lead-ai-automation.service.js";
import { publishRealtimeEvent } from "../realtime/realtime.service.js";
import type {
  CancelMeetingRequestInput,
  MeetingOutcomeInput,
  RescheduleMeetingInput,
  ConfirmMeetingRequestInput,
  CreateMeetingRequestInput,
  ListMeetingRequestsQuery
} from "./meeting.schemas.js";

const meetingRequestInclude = {
  lead: { include: { company: true, contact: true, owner: true, stage: true } },
  owner: true,
  requestedBy: true,
  confirmedBy: true,
  slots: { orderBy: { startsAt: "asc" as const } }
} satisfies Prisma.MeetingRequestInclude;

type MeetingRequestRecord = Prisma.MeetingRequestGetPayload<{
  include: typeof meetingRequestInclude;
}>;

async function scheduleMeetingReminder(
  client: Prisma.TransactionClient,
  request: Pick<MeetingRequestRecord, "id" | "leadId" | "reminderMinutes">,
  slot: { id: string; startsAt: Date }
): Promise<void> {
  if (request.reminderMinutes === 0 || slot.startsAt <= new Date()) return;
  await publishDomainEvent({
    client,
    eventType: "MEETING_REMINDER_DUE",
    aggregateType: "MeetingRequest",
    aggregateId: request.id,
    idempotencyKey: `meeting-reminder:${request.id}:${slot.id}`,
    nextAttemptAt: new Date(Math.max(Date.now(), slot.startsAt.getTime() - request.reminderMinutes * 60000)),
    payload: { leadId: request.leadId, selectedSlotId: slot.id }
  });
}

function requireActiveWorkspaceId(actor: AuthenticatedUser): string {
  if (!actor.activeWorkspaceId) {
    throw new AppError(403, "AUTHORIZATION_ERROR", "An active workspace is required");
  }
  return actor.activeWorkspaceId;
}

function accessibleLeadWhere(actor: AuthenticatedUser): Prisma.LeadWhereInput {
  return {
    workspaceId: requireActiveWorkspaceId(actor),
    ...(isWorkspaceManager(actor) ? {} : { OR: [{ ownerId: actor.id }, { ownerId: null }] })
  };
}

function accessibleMeetingWhere(actor: AuthenticatedUser): Prisma.MeetingRequestWhereInput {
  return {
    workspaceId: requireActiveWorkspaceId(actor),
    lead: accessibleLeadWhere(actor)
  };
}

function toSlotDto(slot: MeetingRequestRecord["slots"][number]): MeetingSlotDto {
  return {
    id: slot.id,
    meetingRequestId: slot.meetingRequestId,
    startsAt: slot.startsAt.toISOString(),
    endsAt: slot.endsAt.toISOString(),
    timeZone: slot.timeZone,
    status: slot.status,
    createdAt: slot.createdAt.toISOString(),
    updatedAt: slot.updatedAt.toISOString()
  };
}

export function toMeetingRequestDto(request: MeetingRequestRecord): MeetingRequestDto {
  return {
    id: request.id,
    leadId: request.leadId,
    contactId: request.contactId,
    conversationId: request.conversationId,
    ownerId: request.ownerId,
    requestedByUserId: request.requestedByUserId,
    confirmedByUserId: request.confirmedByUserId,
    status: request.status,
    title: request.title,
    description: request.description,
    timeZone: request.timeZone,
    durationMinutes: request.durationMinutes,
    slotMinutes: request.slotMinutes,
    meetingMode: request.meetingMode as MeetingRequestDto["meetingMode"],
    location: request.location,
    reminderMinutes: request.reminderMinutes,
    reminderSentAt: request.reminderSentAt?.toISOString() ?? null,
    outcome: request.outcome as MeetingRequestDto["outcome"],
    outcomeNotes: request.outcomeNotes,
    completedAt: request.completedAt?.toISOString() ?? null,
    windowStart: request.windowStart.toISOString(),
    windowEnd: request.windowEnd.toISOString(),
    selectedSlotId: request.selectedSlotId,
    provider: request.provider,
    providerMeetingId: request.providerMeetingId,
    providerMeetingUrl: request.providerMeetingUrl,
    providerCalendarId: request.providerCalendarId,
    providerOrganizerEmail: request.providerOrganizerEmail,
    providerSyncStatus: request.providerSyncStatus,
    providerLastError: request.providerLastError,
    zohoSyncStatus: request.zohoSyncStatus,
    zohoLastError: request.zohoLastError,
    partyNotificationStatus: request.partyNotificationStatus,
    partyNotificationNote: request.partyNotificationNote,
    confirmedAt: request.confirmedAt?.toISOString() ?? null,
    createdAt: request.createdAt.toISOString(),
    updatedAt: request.updatedAt.toISOString(),
    lead: toLeadDto(request.lead),
    owner: request.owner ? toPublicUser(request.owner) : null,
    requestedBy: toPublicUser(request.requestedBy),
    confirmedBy: request.confirmedBy ? toPublicUser(request.confirmedBy) : null,
    slots: request.slots.map(toSlotDto)
  };
}

async function publishMeetingUpdate(request: MeetingRequestRecord, action: string): Promise<void> {
  await publishRealtimeEvent({
    entityType: "meeting",
    action,
    leadId: request.leadId,
    conversationId: request.conversationId
  });
}

function defaultIdempotencyKey(input: CreateMeetingRequestInput): string {
  return `meeting-request:${input.leadId}:${input.windowStart.toISOString()}:${input.windowEnd.toISOString()}:${String(input.durationMinutes)}`;
}

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function buildMeetingTitle(lead: {
  company?: { name: string } | null;
  contact: { firstName: string; lastName: string };
}): string {
  const contactName = `${lead.contact.firstName} ${lead.contact.lastName}`.trim();
  const companyName = lead.company ? lead.company.name.trim() : null;
  if (companyName && contactName) {
    return `Meeting with ${contactName} from ${companyName}`;
  }
  if (contactName) {
    return `Meeting with ${contactName}`;
  }
  return `Meeting with ${companyName ?? "prospect"}`;
}

function clockParts(value: string): { hours: number; minutes: number } {
  const [hours = "9", minutes = "0"] = value.split(":");
  return { hours: Number(hours), minutes: Number(minutes) };
}

function timeZoneOffsetMs(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? "0");
  const asUtc = Date.UTC(
    value("year"),
    value("month") - 1,
    value("day"),
    value("hour"),
    value("minute"),
    value("second")
  );
  return asUtc - date.getTime();
}

function zonedDateTime(input: {
  year: number;
  month: number;
  day: number;
  hours: number;
  minutes: number;
  timeZone: string;
}): Date {
  const utcGuess = new Date(
    Date.UTC(input.year, input.month - 1, input.day, input.hours, input.minutes, 0, 0)
  );
  return new Date(utcGuess.getTime() - timeZoneOffsetMs(utcGuess, input.timeZone));
}

function nextMeetingRequestWindow(now = new Date()): {
  timeZone: string;
  windowStart: Date;
  windowEnd: Date;
  durationMinutes: number;
  slotMinutes: number;
} {
  const config = getCalendarConfig();
  const startClock = clockParts(config.workdayStart);
  const endClock = clockParts(config.workdayEnd);
  const nextDay = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const localParts = new Intl.DateTimeFormat("en-US", {
    timeZone: config.defaultTimeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(nextDay);
  const part = (type: string) =>
    Number(localParts.find((item) => item.type === type)?.value ?? "0");
  const year = part("year");
  const month = part("month");
  const day = part("day");
  const windowStart = zonedDateTime({
    year,
    month,
    day,
    hours: startClock.hours,
    minutes: startClock.minutes,
    timeZone: config.defaultTimeZone
  });
  const windowEnd = zonedDateTime({
    year,
    month,
    day,
    hours: endClock.hours,
    minutes: endClock.minutes,
    timeZone: config.defaultTimeZone
  });
  return {
    timeZone: config.defaultTimeZone,
    windowStart,
    windowEnd,
    durationMinutes: config.slotMinutes,
    slotMinutes: config.slotMinutes
  };
}

function toAuthenticatedUser(
  user: User,
  workspaceId: string,
  workspaceRole: WorkspaceRole
): AuthenticatedUser {
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    role: user.role,
    status: user.status,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    activeWorkspaceId: workspaceId,
    activeWorkspaceRole: workspaceRole
  };
}

async function createMeetingAttentionNotification(input: {
  client: Prisma.TransactionClient;
  workspaceId: string;
  requestId: string;
  leadId: string;
  conversationId: string | null;
  ownerId: string | null;
  title: string;
  body: string;
  severity: "INFO" | "WARNING" | "CRITICAL";
  status?: "UNREAD" | "ATTENTION_REQUIRED";
}): Promise<void> {
  await input.client.internalNotification.upsert({
    where: {
      idempotencyKey: `notification:meeting-request:${input.requestId}:${input.status ?? "UNREAD"}`
    },
    create: {
      workspaceId: input.workspaceId,
      type: "MEETING_CONFIRMATION",
      status: input.status ?? "UNREAD",
      severity: input.severity,
      title: input.title,
      body: input.body,
      assignedToUserId: input.ownerId,
      leadId: input.leadId,
      conversationId: input.conversationId,
      meetingRequestId: input.requestId,
      sourceEntityType: "MeetingRequest",
      sourceEntityId: input.requestId,
      idempotencyKey: `notification:meeting-request:${input.requestId}:${input.status ?? "UNREAD"}`
    },
    update: { workspaceId: input.workspaceId }
  });
}

function hasUsableProposedSlots(request: MeetingRequestRecord): boolean {
  return (
    request.status === "CONFIRMATION_REQUIRED" &&
    request.slots.some((slot) => slot.status === "PROPOSED")
  );
}

function isReplyCreatedMeetingRequest(request: MeetingRequestRecord): boolean {
  return request.idempotencyKey.startsWith("meeting-request:reply-processing:");
}

async function findReusableMeetingRequestForLead(
  leadId: string,
  workspaceId: string
): Promise<MeetingRequestRecord | null> {
  const candidates = await prisma.meetingRequest.findMany({
    where: {
      workspaceId,
      leadId,
      selectedSlotId: null,
      providerMeetingId: null,
      status: { in: ["CONFIRMATION_REQUIRED", "ATTENTION_REQUIRED"] }
    },
    include: meetingRequestInclude,
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
    take: 10
  });

  return (
    candidates.find(hasUsableProposedSlots) ??
    candidates.find(isReplyCreatedMeetingRequest) ??
    candidates.find((request) => request.status === "ATTENTION_REQUIRED") ??
    null
  );
}

export async function createMeetingRequestForReply(input: {
  leadId: string;
  conversationId: string;
  replyProcessingRunId: string;
  inboundEmailId?: string | null;
  summary: string | null;
}): Promise<MeetingRequestDto> {
  const idempotencyKey = `meeting-request:reply-processing:${input.replyProcessingRunId}`;
  const lead = await prisma.lead.findUnique({
    where: { id: input.leadId },
    include: { company: true, contact: true, owner: true }
  });
  if (!lead) throw new AppError(404, "NOT_FOUND", "Lead not found");
  if (!lead.workspaceId) throw new AppError(409, "CONFLICT", "Lead has no persisted workspace");

  const existing = await prisma.meetingRequest.findFirst({
    where: { idempotencyKey, workspaceId: lead.workspaceId, leadId: lead.id },
    include: meetingRequestInclude
  });
  if (existing) return toMeetingRequestDto(existing);

  const activeOwner = lead.owner?.status === UserStatus.ACTIVE ? lead.owner : null;
  const ownerMembership = activeOwner
    ? await prisma.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId: lead.workspaceId, userId: activeOwner.id } },
        include: { user: true }
      })
    : null;
  const requesterMembership =
    ownerMembership?.status === WorkspaceMemberStatus.ACTIVE
      ? ownerMembership
      : await prisma.workspaceMember.findFirst({
          where: {
            workspaceId: lead.workspaceId,
            status: WorkspaceMemberStatus.ACTIVE,
            user: { status: UserStatus.ACTIVE }
          },
          include: { user: true },
          orderBy: { joinedAt: "asc" }
        });
  if (!requesterMembership) {
    throw new AppError(409, "CONFLICT", "No active user is available to own the meeting request");
  }

  const window = nextMeetingRequestWindow();
  return createMeetingRequest(
    toAuthenticatedUser(requesterMembership.user, lead.workspaceId, requesterMembership.role),
    {
      leadId: input.leadId,
      conversationId: input.conversationId,
      ownerId: requesterMembership.userId,
      title: buildMeetingTitle(lead),
      description:
        input.summary ??
        "Prospect requested a meeting from an inbound reply. Confirmation remains required.",
      timeZone: window.timeZone,
      windowStart: window.windowStart,
      windowEnd: window.windowEnd,
      durationMinutes: window.durationMinutes,
      slotMinutes: window.slotMinutes,
      idempotencyKey
    }
  );
}

export async function confirmMeetingFromCustomerReply(input: {
  leadId: string;
  conversationId: string;
  messageId: string;
}): Promise<boolean> {
  const message = await prisma.message.findFirst({
    where: { id: input.messageId, conversationId: input.conversationId, direction: "INBOUND", senderType: "PROSPECT" },
    include: { conversation: { include: { lead: true } } }
  });
  if (message?.conversation.leadId !== input.leadId || !message.workspaceId) return false;
  const match = /^confirm meeting (\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})[.!]?$/iu.exec(message.body.trim());
  if (!match) return false;
  const phrase = `Confirm meeting ${match[1] ?? ""} ${match[2] ?? ""}`;
  const offered = await prisma.message.findFirst({
    where: {
      workspaceId: message.workspaceId,
      conversation: { leadId: input.leadId, workspaceId: message.workspaceId },
      direction: "OUTBOUND", body: { contains: phrase, mode: "insensitive" },
      createdAt: { lt: message.createdAt }, sentAt: { not: null },
      deliveryStatus: { in: ["SENT", "DELIVERED", "READ"] }
    },
    select: { id: true }
  });
  if (!offered) return false;
  const requests = await prisma.meetingRequest.findMany({
    where: { leadId: input.leadId, workspaceId: message.workspaceId, status: { in: ["CONFIRMATION_REQUIRED", "CONFIRMED"] } },
    include: { slots: { where: { status: { in: ["PROPOSED", "SELECTED"] }, startsAt: { gt: new Date() } } } }
  });
  const matches = requests.flatMap((request) => request.slots.filter((slot) => {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: request.timeZone, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23"
    }).formatToParts(slot.startsAt);
    const value = (key: string) => parts.find((part) => part.type === key)?.value ?? "";
    return `${value("year")}-${value("month")}-${value("day")}` === match[1] && `${value("hour")}:${value("minute")}` === match[2];
  }).map((slot) => ({ request, slot })));
  if (matches.length !== 1) return false;
  const selected = matches[0];
  if (!selected) return false;
  if (selected.request.status === "CONFIRMED") return true;
  const membership = await prisma.workspaceMember.findFirst({
    where: {
      workspaceId: message.workspaceId, status: "ACTIVE", user: { status: "ACTIVE" },
      userId: selected.request.ownerId ?? selected.request.requestedByUserId
    }, include: { user: true }
  });
  if (!membership) return false;
  const result = await confirmMeetingRequest(
    toAuthenticatedUser(membership.user, message.workspaceId, membership.role),
    selected.request.id,
    { slotId: selected.slot.id },
    { customerMessageId: message.id }
  );
  return result.status === "CONFIRMED";
}

export async function createMeetingRequest(
  actor: AuthenticatedUser,
  input: CreateMeetingRequestInput
): Promise<MeetingRequestDto> {
  const workspaceId = requireActiveWorkspaceId(actor);
  const existing = input.idempotencyKey
    ? await prisma.meetingRequest.findFirst({
        where: {
          idempotencyKey: input.idempotencyKey,
          ...accessibleMeetingWhere(actor)
        },
        include: meetingRequestInclude
      })
    : null;
  if (existing) return toMeetingRequestDto(existing);

  const lead = await prisma.lead.findFirst({
    where: { id: input.leadId, ...accessibleLeadWhere(actor) },
    include: { contact: true, company: true }
  });
  if (!lead) throw new AppError(404, "NOT_FOUND", "Lead not found");
  if (lead.status === "WON" || lead.status === "LOST" || lead.status === "DISQUALIFIED") {
    throw new AppError(409, "CONFLICT", "Cannot request a meeting for a terminal lead");
  }
  if (lead.contact.doNotContact) {
    throw new AppError(409, "CONFLICT", "Cannot request a meeting for a do-not-contact contact");
  }
  await assertAgentCapabilityActive(workspaceId, AgentType.MEETING);

  if (input.conversationId) {
    const conversation = await prisma.conversation.findFirst({
      where: {
        id: input.conversationId,
        workspaceId,
        leadId: lead.id
      },
      select: { id: true }
    });
    if (!conversation) {
      throw new AppError(404, "NOT_FOUND", "Conversation not found for this lead");
    }
  }

  const requestIdempotencyKey = input.idempotencyKey ?? defaultIdempotencyKey(input);
  const existingForDefaultKey = input.idempotencyKey
    ? null
    : await prisma.meetingRequest.findFirst({
        where: {
          idempotencyKey: requestIdempotencyKey,
          ...accessibleMeetingWhere(actor)
        },
        include: meetingRequestInclude
      });
  if (existingForDefaultKey) return toMeetingRequestDto(existingForDefaultKey);

  const ownerId = input.ownerId ?? lead.ownerId ?? actor.id;
  const owner = await prisma.user.findFirst({
    where: {
      id: ownerId,
      status: UserStatus.ACTIVE,
      workspaceMemberships: {
        some: { workspaceId, status: WorkspaceMemberStatus.ACTIVE }
      }
    }
  });
  if (!owner) {
    throw new AppError(404, "NOT_FOUND", "Meeting owner was not found or inactive");
  }

  const slotMinutes = input.slotMinutes ?? input.durationMinutes;
  const reusable = input.idempotencyKey
    ? null
    : await findReusableMeetingRequestForLead(lead.id, workspaceId);
  if (reusable && hasUsableProposedSlots(reusable)) {
    return toMeetingRequestDto(reusable);
  }

  const availability = await getCalendarAvailability(actor, {
    ownerUserId: ownerId,
    timeZone: input.timeZone,
    windowStart: input.windowStart,
    windowEnd: input.windowEnd,
    slotMinutes
  });

  if (reusable) {
    const request = await prisma.$transaction(
      async (tx) => {
        const hasSlots = availability.status === "AVAILABLE" && availability.slots.length > 0;
        await tx.meetingRequest.update({
          where: { id: reusable.id },
          data: {
            conversationId: input.conversationId ?? reusable.conversationId,
            ownerId,
            requestedByUserId: actor.id,
            status: hasSlots ? "CONFIRMATION_REQUIRED" : "ATTENTION_REQUIRED",
            title: input.title,
            description: input.description,
            timeZone: input.timeZone,
            durationMinutes: input.durationMinutes,
            slotMinutes,
            meetingMode: input.meetingMode ?? "VIDEO",
            location: input.location ?? null,
            reminderMinutes: input.reminderMinutes ?? 30,
            windowStart: input.windowStart,
            windowEnd: input.windowEnd,
            provider: "GOOGLE_CALENDAR",
            providerSyncStatus: "NOT_REQUIRED",
            providerLastError: hasSlots ? null : availability.unavailableReason,
            providerCalendarId: null,
            providerOrganizerEmail: null,
            zohoSyncStatus: "NOT_REQUIRED",
            partyNotificationStatus: "NOT_REQUIRED",
            partyNotificationNote: "External party notification semantics remain blocked by OC-09",
            confirmedByUserId: null,
            confirmedAt: null,
            providerMeetingId: null,
            providerMeetingUrl: null,
            selectedSlotId: null,
            slots: {
              deleteMany: {},
              create: availability.slots.map((slot) => ({
                startsAt: new Date(slot.startsAt),
                endsAt: new Date(slot.endsAt),
                timeZone: slot.timeZone
              }))
            }
          }
        });

        await tx.lead.update({
          where: { id: lead.id },
          data: {
            nextAction: hasSlots
              ? "Confirm proposed meeting slot"
              : "Review meeting scheduling issue",
            nextActionAt: availability.slots[0]?.startsAt
              ? new Date(availability.slots[0].startsAt)
              : null,
            lastActivityAt: new Date()
          }
        });
        await tx.activity.create({
          data: {
            workspaceId: lead.workspaceId,
            leadId: lead.id,
            actorUserId: actor.id,
            type: "MEETING_REQUESTED",
            description: hasSlots
              ? `Meeting requested with ${String(availability.slots.length)} real available slot(s)`
              : `Meeting request needs attention: ${availability.unavailableReason ?? availability.status}`
          }
        });
        await tx.auditEvent.create({
          data: {
            workspaceId: lead.workspaceId,
            actorType: "USER",
            actorId: actor.id,
            entityType: "MeetingRequest",
            entityId: reusable.id,
            action: hasSlots ? "MEETING_REQUESTED" : "MEETING_REQUEST_ATTENTION_REQUIRED",
            after: {
              leadId: lead.id,
              ownerId,
              status: hasSlots ? "CONFIRMATION_REQUIRED" : "ATTENTION_REQUIRED",
              availabilityStatus: availability.status,
              reusedExistingRequest: true
            }
          }
        });
        await createMeetingAttentionNotification({
          client: tx,
          workspaceId,
          requestId: reusable.id,
          leadId: lead.id,
          conversationId: input.conversationId ?? reusable.conversationId ?? null,
          ownerId,
          title: hasSlots
            ? "Meeting slots need confirmation"
            : "Meeting scheduling needs attention",
          body: hasSlots
            ? `${String(availability.slots.length)} real calendar slot(s) are available for confirmation.`
            : (availability.unavailableReason ?? "Calendar availability is unavailable."),
          severity: hasSlots ? "INFO" : "CRITICAL",
          status: hasSlots ? "UNREAD" : "ATTENTION_REQUIRED"
        });
        await publishDomainEvent({
          client: tx,
          eventType: "MEETING_REQUESTED",
          aggregateType: "MeetingRequest",
          aggregateId: reusable.id,
          idempotencyKey: `domain-event:meeting-requested:${reusable.id}`,
          payload: {
            leadId: lead.id,
            ownerId,
            status: hasSlots ? "CONFIRMATION_REQUIRED" : "ATTENTION_REQUIRED",
            reusedExistingRequest: true
          }
        });
        return tx.meetingRequest.findUniqueOrThrow({
          where: { id: reusable.id },
          include: meetingRequestInclude
        });
      },
      { maxWait: 10000, timeout: 30000 }
    );

    await publishMeetingUpdate(request, "meeting-request-updated");
    return toMeetingRequestDto(request);
  }

  const request = await prisma
    .$transaction(
      async (tx) => {
        const hasSlots = availability.status === "AVAILABLE" && availability.slots.length > 0;
        const created = await tx.meetingRequest.create({
          data: {
            workspaceId: lead.workspaceId,
            leadId: lead.id,
            contactId: lead.contactId,
            conversationId: input.conversationId,
            ownerId,
            requestedByUserId: actor.id,
            status: hasSlots ? "CONFIRMATION_REQUIRED" : "ATTENTION_REQUIRED",
            title: input.title,
            description: input.description,
            timeZone: input.timeZone,
            durationMinutes: input.durationMinutes,
            slotMinutes,
            meetingMode: input.meetingMode ?? "VIDEO",
            location: input.location ?? null,
            reminderMinutes: input.reminderMinutes ?? 30,
            windowStart: input.windowStart,
            windowEnd: input.windowEnd,
            provider: "GOOGLE_CALENDAR",
            providerSyncStatus: "NOT_REQUIRED",
            providerLastError: hasSlots ? null : availability.unavailableReason,
            providerCalendarId: null,
            providerOrganizerEmail: null,
            zohoSyncStatus: "NOT_REQUIRED",
            partyNotificationStatus: "NOT_REQUIRED",
            partyNotificationNote: "External party notification semantics remain blocked by OC-09",
            idempotencyKey: requestIdempotencyKey,
            slots: {
              create: availability.slots.map((slot) => ({
                startsAt: new Date(slot.startsAt),
                endsAt: new Date(slot.endsAt),
                timeZone: slot.timeZone
              }))
            }
          }
        });

        await tx.lead.update({
          where: { id: lead.id },
          data: {
            nextAction: hasSlots
              ? "Confirm proposed meeting slot"
              : "Review meeting scheduling issue",
            nextActionAt: availability.slots[0]?.startsAt
              ? new Date(availability.slots[0].startsAt)
              : null,
            lastActivityAt: new Date()
          }
        });
        await tx.activity.create({
          data: {
            workspaceId: lead.workspaceId,
            leadId: lead.id,
            actorUserId: actor.id,
            type: "MEETING_REQUESTED",
            description: hasSlots
              ? `Meeting requested with ${String(availability.slots.length)} real available slot(s)`
              : `Meeting request needs attention: ${availability.unavailableReason ?? availability.status}`
          }
        });
        await tx.auditEvent.create({
          data: {
            workspaceId: lead.workspaceId,
            actorType: "USER",
            actorId: actor.id,
            entityType: "MeetingRequest",
            entityId: created.id,
            action: hasSlots ? "MEETING_REQUESTED" : "MEETING_REQUEST_ATTENTION_REQUIRED",
            after: {
              leadId: lead.id,
              ownerId,
              status: hasSlots ? "CONFIRMATION_REQUIRED" : "ATTENTION_REQUIRED",
              availabilityStatus: availability.status
            }
          }
        });
        await createMeetingAttentionNotification({
          client: tx,
          workspaceId,
          requestId: created.id,
          leadId: lead.id,
          conversationId: input.conversationId ?? null,
          ownerId,
          title: hasSlots
            ? "Meeting slots need confirmation"
            : "Meeting scheduling needs attention",
          body: hasSlots
            ? `${String(availability.slots.length)} real calendar slot(s) are available for confirmation.`
            : (availability.unavailableReason ?? "Calendar availability is unavailable."),
          severity: hasSlots ? "INFO" : "CRITICAL",
          status: hasSlots ? "UNREAD" : "ATTENTION_REQUIRED"
        });
        await publishDomainEvent({
          client: tx,
          eventType: "MEETING_REQUESTED",
          aggregateType: "MeetingRequest",
          aggregateId: created.id,
          idempotencyKey: `domain-event:meeting-requested:${created.id}`,
          payload: {
            leadId: lead.id,
            ownerId,
            status: hasSlots ? "CONFIRMATION_REQUIRED" : "ATTENTION_REQUIRED"
          }
        });
        return tx.meetingRequest.findUniqueOrThrow({
          where: { id: created.id },
          include: meetingRequestInclude
        });
      },
      { maxWait: 10000, timeout: 30000 }
    )
    .catch(async (error: unknown) => {
      if (!isUniqueConstraintError(error)) throw error;
      const existingRequest = await prisma.meetingRequest.findFirst({
        where: {
          idempotencyKey: requestIdempotencyKey,
          ...accessibleMeetingWhere(actor)
        },
        include: meetingRequestInclude
      });
      if (!existingRequest) {
        throw new AppError(409, "CONFLICT", "Meeting request idempotency key is unavailable");
      }
      return existingRequest;
    });

  await publishMeetingUpdate(request, "meeting-request-created");
  return toMeetingRequestDto(request);
}

export async function listMeetingRequests(
  actor: AuthenticatedUser,
  query: ListMeetingRequestsQuery
): Promise<MeetingRequestDto[]> {
  const requests = await prisma.meetingRequest.findMany({
    where: {
      ...accessibleMeetingWhere(actor),
      leadId: query.leadId,
      status: query.status
    },
    include: meetingRequestInclude,
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
    take: query.limit
  });
  return requests.map(toMeetingRequestDto);
}

export async function getMeetingRequest(
  actor: AuthenticatedUser,
  requestId: string
): Promise<MeetingRequestDto> {
  const request = await prisma.meetingRequest.findFirst({
    where: { id: requestId, ...accessibleMeetingWhere(actor) },
    include: meetingRequestInclude
  });
  if (!request) throw new AppError(404, "NOT_FOUND", "Meeting request not found");
  return toMeetingRequestDto(request);
}

export async function cancelMeetingRequest(
  actor: AuthenticatedUser,
  requestId: string,
  input: CancelMeetingRequestInput
): Promise<MeetingRequestDto> {
  const request = await prisma.meetingRequest.findFirst({
    where: { id: requestId, ...accessibleMeetingWhere(actor) },
    include: meetingRequestInclude
  });
  if (!request) throw new AppError(404, "NOT_FOUND", "Meeting request not found");
  if (request.status === "CANCELLED") return toMeetingRequestDto(request);
  if (request.outcome) throw new AppError(409, "CONFLICT", "A meeting with a recorded outcome cannot be cancelled");
  if (request.status === "PROVIDER_PENDING") {
    throw new AppError(409, "CONFLICT", "Calendar confirmation is still in progress. Retry shortly.");
  }
  const locked = await prisma.meetingRequest.updateMany({
    where: { id: request.id, status: request.status, updatedAt: request.updatedAt },
    data: { status: "PROVIDER_PENDING" }
  });
  if (locked.count !== 1) throw new AppError(409, "CONFLICT", "Another meeting change is in progress. Refresh and try again.");
  try {
    if (request.status === "CONFIRMED") {
    if (!request.providerMeetingId) {
      throw new AppError(409, "CONFLICT", "The calendar event ID is missing; review this meeting before cancelling.");
    }
    if (!request.workspaceId) throw new AppError(409, "CONFLICT", "Meeting workspace is missing");
    const config = await resolveWorkspaceCalendarConfig(request.workspaceId);
    const configuredCalendarId = config.provider === "google" ? config.google.calendarId : config.microsoft.userId;
    if (request.providerCalendarId && request.providerCalendarId !== configuredCalendarId) {
      throw new AppError(409, "CONFLICT", "Reconnect the calendar used for this meeting before cancelling");
    }
    const mapping = await prisma.externalRecordMapping.findUnique({
      where: { workspaceId_provider_entityType_localEntityId: {
        workspaceId: request.workspaceId,
        provider: "GOOGLE_CALENDAR",
        entityType: "MEETING",
        localEntityId: request.id
      } },
      select: { idempotencyKey: true }
    });
    if (mapping?.idempotencyKey && !mapping.idempotencyKey.startsWith(`${config.provider}-calendar:`)) {
      throw new AppError(409, "CONFLICT", "Reconnect the calendar provider used for this meeting before cancelling.");
    }
    const providerResult = await createCalendarProvider(config).cancelMeeting({
      externalMeetingId: request.providerMeetingId
    });
    if (providerResult.status !== "SYNCED") {
      throw new AppError(503, "PROVIDER_ERROR", providerResult.lastError ?? "Calendar cancellation could not be confirmed");
    }
    }
  } catch (error) {
    await prisma.meetingRequest.updateMany({
      where: { id: request.id, status: "PROVIDER_PENDING" },
      data: { status: request.status }
    });
    throw error;
  }
  const updated = await prisma.$transaction(async (tx) => {
    const changed = await tx.meetingRequest.updateMany({
      where: { id: request.id, status: "PROVIDER_PENDING" },
      data: {
        status: "CANCELLED",
        partyNotificationNote: request.status === "CONFIRMED"
          ? "The calendar cancellation was sent to invited attendees."
          : "The meeting request was cancelled before confirmation."
      }
    });
    if (changed.count !== 1) {
      throw new AppError(409, "CONFLICT", "Meeting changed while cancelling. Refresh and try again.");
    }
    const selectedSlot = request.slots.find((slot) => slot.id === request.selectedSlotId);
    if (selectedSlot) {
      await tx.lead.updateMany({
        where: { id: request.leadId, nextAction: "Prepare for confirmed meeting", nextActionAt: selectedSlot.startsAt },
        data: { nextAction: "Plan next step after cancelled meeting", nextActionAt: null, lastActivityAt: new Date() }
      });
    }
    await tx.activity.create({
      data: {
        workspaceId: request.workspaceId,
        leadId: request.leadId,
        actorType: "USER",
        actorUserId: actor.id,
        sourceType: "MEETING_REQUEST",
        sourceId: request.id,
        type: "NOTE_ADDED",
        title: "Meeting cancelled",
        description: input.reason,
        visibility: "BUSINESS"
      }
    });
    await tx.auditEvent.create({
      data: {
        workspaceId: request.workspaceId,
        actorType: "USER",
        actorId: actor.id,
        entityType: "MeetingRequest",
        entityId: request.id,
        action: "MEETING_CANCELLED",
        before: { status: request.status, providerMeetingId: request.providerMeetingId },
        after: { status: "CANCELLED", reason: input.reason }
      }
    });
    return tx.meetingRequest.findUniqueOrThrow({ where: { id: request.id }, include: meetingRequestInclude });
  });
  await publishMeetingUpdate(updated, "meeting-cancelled");
  return toMeetingRequestDto(updated);
}

export async function recordMeetingOutcome(
  actor: AuthenticatedUser,
  requestId: string,
  input: MeetingOutcomeInput
): Promise<MeetingRequestDto> {
  const request = await prisma.meetingRequest.findFirst({
    where: { id: requestId, ...accessibleMeetingWhere(actor) },
    include: meetingRequestInclude
  });
  if (!request) throw new AppError(404, "NOT_FOUND", "Meeting request not found");
  if (request.status !== "CONFIRMED") throw new AppError(409, "CONFLICT", "Confirm the meeting before recording its outcome");
  if (request.outcome) {
    if (request.outcome === input.outcome && request.outcomeNotes === input.notes) return toMeetingRequestDto(request);
    throw new AppError(409, "CONFLICT", "This meeting already has a recorded outcome");
  }
  const slot = request.slots.find((item) => item.id === request.selectedSlotId);
  if (!slot || slot.startsAt > new Date()) throw new AppError(409, "CONFLICT", "Record the outcome after the meeting starts");
  const updated = await prisma.$transaction(async (tx) => {
    const claimed = await tx.meetingRequest.updateMany({
      where: { id: request.id, status: "CONFIRMED", outcome: null, selectedSlotId: request.selectedSlotId, updatedAt: request.updatedAt },
      data: { outcome: input.outcome, outcomeNotes: input.notes, completedAt: new Date() }
    });
    if (claimed.count !== 1) throw new AppError(409, "CONFLICT", "Meeting changed. Refresh before saving the outcome.");
    await tx.activity.create({ data: {
      workspaceId: request.workspaceId,
      leadId: request.leadId,
      actorType: "USER",
      actorUserId: actor.id,
      sourceType: "MEETING_REQUEST",
      sourceId: request.id,
      type: "NOTE_ADDED",
      title: input.outcome === "COMPLETED" ? "Meeting completed" : "Customer did not attend",
      description: input.notes,
      visibility: "BUSINESS",
      metadata: { meetingRequestId: request.id, outcome: input.outcome }
    } });
    await tx.auditEvent.create({ data: {
      workspaceId: request.workspaceId,
      actorType: "USER",
      actorId: actor.id,
      entityType: "MeetingRequest",
      entityId: request.id,
      action: "MEETING_OUTCOME_RECORDED",
      after: { outcome: input.outcome, notes: input.notes },
      correlationId: input.idempotencyKey
    } });
    await tx.lead.updateMany({
      where: { id: request.leadId, nextAction: "Prepare for confirmed meeting", nextActionAt: slot.startsAt },
      data: {
        nextAction: input.outcome === "COMPLETED" ? "Review meeting notes and agree next steps" : "Contact customer to rearrange the meeting",
        nextActionAt: null,
        lastActivityAt: new Date()
      }
    });
    return tx.meetingRequest.findUniqueOrThrow({ where: { id: request.id }, include: meetingRequestInclude });
  });
  // Meeting notes alone do not confirm that the promised customer response was sent.
  await publishMeetingUpdate(updated, "meeting-outcome-recorded");
  return toMeetingRequestDto(updated);
}

export async function rescheduleMeetingRequest(
  actor: AuthenticatedUser,
  requestId: string,
  input: RescheduleMeetingInput
): Promise<MeetingRequestDto> {
  const request = await prisma.meetingRequest.findFirst({
    where: { id: requestId, ...accessibleMeetingWhere(actor) },
    include: meetingRequestInclude
  });
  if (!request) throw new AppError(404, "NOT_FOUND", "Meeting request not found");
  if (request.status !== "CONFIRMED" || request.outcome || !request.providerMeetingId) {
    throw new AppError(409, "CONFLICT", "Only an upcoming confirmed meeting can be rescheduled");
  }
  if (request.lead.contact.doNotContact || ["WON", "LOST", "DISQUALIFIED"].includes(request.lead.status)) {
    throw new AppError(409, "CONFLICT", "This lead cannot receive a new meeting invitation");
  }
  const currentSlot = request.slots.find((item) => item.id === request.selectedSlotId);
  if (currentSlot?.startsAt.getTime() === input.startsAt.getTime() && currentSlot.endsAt.getTime() === input.endsAt.getTime()) {
    return toMeetingRequestDto(request);
  }
  if (!request.workspaceId) throw new AppError(409, "CONFLICT", "Meeting workspace is missing");
  const config = await resolveWorkspaceCalendarConfig(request.workspaceId);
  if (request.providerCalendarId && request.providerCalendarId !== (config.provider === "google" ? config.google.calendarId : config.microsoft.userId)) {
    throw new AppError(409, "CONFLICT", "Reconnect the calendar used for this meeting before rescheduling");
  }
  const durationMinutes = (input.endsAt.getTime() - input.startsAt.getTime()) / 60000;
  if (!Number.isInteger(durationMinutes) || durationMinutes < 15 || durationMinutes > 240) {
    throw new AppError(400, "VALIDATION_ERROR", "Meeting duration must be between 15 and 240 minutes");
  }
  const availability = await getCalendarAvailability(actor, {
    ownerUserId: request.ownerId ?? actor.id,
    timeZone: request.timeZone,
    windowStart: input.startsAt,
    windowEnd: input.endsAt,
    slotMinutes: durationMinutes
  });
  if (availability.status !== "AVAILABLE" || !availability.slots.some((slot) =>
    slot.startsAt === input.startsAt.toISOString() && slot.endsAt === input.endsAt.toISOString())) {
    throw new AppError(409, "CONFLICT", availability.unavailableReason ?? "The selected meeting time is unavailable");
  }
  const claimed = await prisma.meetingRequest.updateMany({
    where: { id: request.id, status: "CONFIRMED", selectedSlotId: request.selectedSlotId, outcome: null },
    data: { status: "PROVIDER_PENDING" }
  });
  if (claimed.count !== 1) throw new AppError(409, "CONFLICT", "Another meeting change is in progress. Refresh and try again.");
  const result = await createCalendarProvider(config).rescheduleMeeting({
    externalMeetingId: request.providerMeetingId,
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    timeZone: request.timeZone
  });
  if (result.status !== "SYNCED") {
    await prisma.meetingRequest.update({ where: { id: request.id }, data: {
      status: "CONFIRMED", providerLastError: result.lastError ?? "Rescheduling could not be confirmed"
    } });
    throw new AppError(503, "PROVIDER_ERROR", result.lastError ?? "Rescheduling could not be confirmed; check the calendar before retrying");
  }
  const updated = await prisma.$transaction(async (tx) => {
    await tx.meetingSlot.updateMany({ where: { meetingRequestId: request.id }, data: { status: "EXPIRED" } });
    const slot = await tx.meetingSlot.upsert({
      where: { meetingRequestId_startsAt_endsAt: { meetingRequestId: request.id, startsAt: input.startsAt, endsAt: input.endsAt } },
      create: { meetingRequestId: request.id, startsAt: input.startsAt, endsAt: input.endsAt, timeZone: request.timeZone, status: "SELECTED" },
      update: { status: "SELECTED" }
    });
    const changed = await tx.meetingRequest.update({ where: { id: request.id }, data: {
      status: "CONFIRMED", selectedSlotId: slot.id, durationMinutes, reminderSentAt: null,
      providerLastError: null, partyNotificationNote: "Updated calendar invitations were requested for the new meeting time."
    }, include: meetingRequestInclude });
    await tx.lead.updateMany({
      where: { id: request.leadId, nextAction: "Prepare for confirmed meeting", nextActionAt: currentSlot?.startsAt },
      data: { nextActionAt: input.startsAt, lastActivityAt: new Date() }
    });
    await tx.activity.create({ data: {
      workspaceId: request.workspaceId, leadId: request.leadId,
      actorType: "USER", actorUserId: actor.id, sourceType: "MEETING_REQUEST", sourceId: request.id,
      type: "MEETING_CONFIRMED", title: "Meeting rescheduled", description: input.reason,
      visibility: "BUSINESS", metadata: { startsAt: input.startsAt.toISOString(), endsAt: input.endsAt.toISOString() }
    } });
    await tx.auditEvent.create({ data: {
      workspaceId: request.workspaceId, actorType: "USER", actorId: actor.id,
      entityType: "MeetingRequest", entityId: request.id, action: "MEETING_RESCHEDULED",
      before: { selectedSlotId: request.selectedSlotId },
      after: { selectedSlotId: slot.id, startsAt: input.startsAt.toISOString(), endsAt: input.endsAt.toISOString(), reason: input.reason }
    } });
    await scheduleMeetingReminder(tx, changed, slot);
    return changed;
  });
  await publishMeetingUpdate(updated, "meeting-rescheduled");
  return toMeetingRequestDto(updated);
}

export async function confirmMeetingRequest(
  actor: AuthenticatedUser,
  requestId: string,
  input: ConfirmMeetingRequestInput,
  options?: { customerMessageId: string }
): Promise<MeetingRequestDto> {
  const request = await prisma.meetingRequest.findFirst({
    where: { id: requestId, ...accessibleMeetingWhere(actor) },
    include: {
      ...meetingRequestInclude,
      lead: { include: { company: true, contact: true, owner: true, stage: true } }
    }
  });
  if (!request) throw new AppError(404, "NOT_FOUND", "Meeting request not found");
  if (request.status === "CONFIRMED") return toMeetingRequestDto(request);
  if (request.status === "CANCELLED") {
    throw new AppError(409, "CONFLICT", "Cannot confirm a cancelled meeting request");
  }
  if (request.status === "PROVIDER_PENDING") throw new AppError(409, "CONFLICT", "Meeting confirmation is already in progress");
  if (request.lead.contact.doNotContact || ["WON", "LOST", "DISQUALIFIED"].includes(request.lead.status)) {
    throw new AppError(409, "CONFLICT", "This lead cannot receive a meeting invitation");
  }

  const slot = request.slots.find((item) => item.id === input.slotId);
  if (!slot) throw new AppError(404, "NOT_FOUND", "Meeting slot not found");

  const availability = await getCalendarAvailability(actor, {
    ownerUserId: request.ownerId ?? actor.id,
    timeZone: slot.timeZone,
    windowStart: slot.startsAt,
    windowEnd: slot.endsAt,
    slotMinutes: request.durationMinutes
  });
  const exactSlotStillAvailable =
    availability.status === "AVAILABLE" &&
    availability.slots.some(
      (item) =>
        item.startsAt === slot.startsAt.toISOString() && item.endsAt === slot.endsAt.toISOString()
    );

  if (!exactSlotStillAvailable) {
    const changed = await prisma.meetingRequest.updateMany({
      where: { id: request.id, status: request.status, updatedAt: request.updatedAt },
      data: {
        status: "ATTENTION_REQUIRED",
        providerSyncStatus: availability.status === "NOT_CONFIGURED" ? "NOT_CONFIGURED" : "FAILED",
        providerLastError:
          availability.unavailableReason ?? "Selected meeting slot is no longer available"
      }
    });
    if (changed.count !== 1) throw new AppError(409, "CONFLICT", "Meeting changed while checking availability. Refresh and try again.");
    const updated = await prisma.meetingRequest.findUniqueOrThrow({ where: { id: request.id }, include: meetingRequestInclude });
    await publishMeetingUpdate(updated, "meeting-request-attention-required");
    return toMeetingRequestDto(updated);
  }

  const claimed = await prisma.meetingRequest.updateMany({
    where: { id: request.id, status: request.status, updatedAt: request.updatedAt },
    data: { status: "PROVIDER_PENDING", providerSyncStatus: "PENDING", providerLastError: null }
  });
  if (claimed.count !== 1) throw new AppError(409, "CONFLICT", "Meeting changed. Refresh before confirming.");

  if (!request.workspaceId) throw new AppError(409, "CONFLICT", "Meeting workspace is missing");
  const calendarConfig = await resolveWorkspaceCalendarConfig(request.workspaceId);
  const provider = createCalendarProvider(calendarConfig);
  const createResult = await provider.createMeeting({
    idempotencyKey: `meeting:${request.id}`,
    title: request.title,
    description: request.description,
    startsAt: slot.startsAt,
    endsAt: slot.endsAt,
    timeZone: slot.timeZone,
    attendees: request.lead.contact.email ? [request.lead.contact.email] : [],
    meetingMode: request.meetingMode as MeetingRequestDto["meetingMode"],
    location: request.location
  });

  if (createResult.status !== "SYNCED" || !createResult.externalMeetingId) {
    const updated = await prisma.meetingRequest.update({
      where: { id: request.id },
      data: {
        status: "ATTENTION_REQUIRED",
        providerSyncStatus: createResult.status,
        providerLastError:
          createResult.lastError ?? "Calendar provider did not confirm meeting creation"
      },
      include: meetingRequestInclude
    });
    await publishMeetingUpdate(updated, "meeting-request-attention-required");
    return toMeetingRequestDto(updated);
  }
  const externalMeetingId = createResult.externalMeetingId;

  const confirmed = await prisma.$transaction(
    async (tx) => {
      await tx.meetingSlot.updateMany({
        where: { meetingRequestId: request.id },
        data: { status: "EXPIRED" }
      });
      await tx.meetingSlot.update({
        where: { id: slot.id },
        data: { status: "SELECTED" }
      });
      const updated = await tx.meetingRequest.update({
        where: { id: request.id },
        data: {
          status: "CONFIRMED",
          selectedSlotId: slot.id,
          confirmedByUserId: options?.customerMessageId ? null : actor.id,
          confirmedAt: new Date(),
          providerMeetingId: externalMeetingId,
          providerMeetingUrl: createResult.externalMeetingUrl,
          providerCalendarId: createResult.externalCalendarId,
          providerOrganizerEmail: createResult.organizerEmail,
          providerSyncStatus: "SYNCED",
          providerLastError: null,
          zohoSyncStatus: "PENDING",
          zohoLastError: null,
          partyNotificationStatus: request.lead.contact.email ? "SYNCED" : "NOT_REQUIRED",
          partyNotificationNote: request.lead.contact.email
            ? `${
                calendarConfig.conferenceProvider === "zoom"
                  ? "Zoom and the calendar provider"
                  : calendarConfig.provider === "microsoft"
                    ? "Microsoft Calendar"
                    : "Google Calendar"
              } sent an invitation to the contact email.`
            : "No contact email is available for an external invitation."
        }
      });
      if (!request.workspaceId) {
        throw new AppError(409, "CONFLICT", "Meeting request has no persisted workspace");
      }
      await tx.externalRecordMapping.upsert({
        where: {
          workspaceId_provider_entityType_localEntityId: {
            workspaceId: request.workspaceId,
            provider: "GOOGLE_CALENDAR",
            entityType: "MEETING",
            localEntityId: request.id
          }
        },
        create: {
          workspaceId: request.workspaceId,
          provider: "GOOGLE_CALENDAR",
          entityType: "MEETING",
          localEntityId: request.id,
          externalRecordId: externalMeetingId,
          syncDirection: "OUTBOUND",
          syncStatus: "SYNCED",
          lastSyncedAt: new Date(),
          idempotencyKey: `${calendarConfig.provider}-calendar:meeting:${request.id}`
        },
        update: {
          externalRecordId: externalMeetingId,
          syncStatus: "SYNCED",
          lastSyncedAt: new Date(),
          lastErrorCode: null,
          lastErrorMessage: null
        }
      });
      await tx.lead.update({
        where: { id: request.leadId },
        data: {
          nextAction: "Prepare for confirmed meeting",
          nextActionAt: slot.startsAt,
          lastActivityAt: new Date()
        }
      });
      const activity = await tx.activity.create({
        data: {
          workspaceId: request.workspaceId,
          leadId: request.leadId,
          actorUserId: options?.customerMessageId ? null : actor.id,
          type: "MEETING_CONFIRMED",
          description: `Meeting confirmed for ${slot.startsAt.toISOString()}`
        }
      });
      await tx.internalNotification.updateMany({
        where: {
          meetingRequestId: request.id,
          status: { in: ["UNREAD", "READ", "ATTENTION_REQUIRED"] }
        },
        data: {
          status: "ACKNOWLEDGED",
          readByUserId: actor.id,
          acknowledgedByUserId: actor.id,
          readAt: new Date(),
          acknowledgedAt: new Date()
        }
      });
      await tx.auditEvent.create({
        data: {
          workspaceId: request.workspaceId,
          actorType: options?.customerMessageId ? "SYSTEM" : "USER",
          actorId: options?.customerMessageId ? null : actor.id,
          entityType: "MeetingRequest",
          entityId: request.id,
          action: "MEETING_CONFIRMED",
          after: {
            leadId: request.leadId,
            selectedSlotId: slot.id,
            providerMeetingId: externalMeetingId,
            zohoSyncStatus: "PENDING"
          }
        }
      });
      await publishDomainEvent({
        client: tx,
        eventType: "MEETING_CONFIRMED",
        aggregateType: "MeetingRequest",
        aggregateId: request.id,
        idempotencyKey: `domain-event:meeting-confirmed:${request.id}`,
        priority: "HIGH",
        payload: {
          leadId: request.leadId,
          selectedSlotId: slot.id,
          providerMeetingId: externalMeetingId,
          activityId: activity.id
        }
      });
      await scheduleMeetingReminder(tx, request, slot);
      return tx.meetingRequest.findUniqueOrThrow({
        where: { id: updated.id },
        include: meetingRequestInclude
      });
    },
    { maxWait: 10000, timeout: 30000 }
  );

  const ownership = options?.customerMessageId ? { activated: false } : await completeHumanAction({
    leadId: request.leadId,
    reason: "MEETING_CONFIRMED",
    actorType: "USER",
    actorId: actor.id,
    sourceType: "MEETING_REQUEST",
    sourceId: request.id,
    correlationId: externalMeetingId
  });
  if (ownership.activated) {
    await autoStartLeadAiAutomation(actor, request.leadId, {
      cycleKey: `meeting:${request.id}:${externalMeetingId}`
    });
  }

  await publishMeetingUpdate(confirmed, "meeting-confirmed");
  return toMeetingRequestDto(confirmed);
}
