import { Prisma, UserRole, UserStatus, type User } from "@prisma/client";
import type { MeetingRequestDto, MeetingSlotDto } from "@shilabs/shared-types";
import { AppError } from "../../shared/errors.js";
import { prisma } from "../../shared/prisma.js";
import { toPublicUser } from "../auth/auth.service.js";
import type { AuthenticatedUser } from "../auth/auth.types.js";
import { getCalendarAvailability } from "../calendar/calendar.service.js";
import { createCalendarProvider } from "../calendar/calendar.provider.js";
import { getCalendarConfig } from "@shilabs/shared-config";
import { publishDomainEvent } from "../domain-events/domain-events.service.js";
import { toLeadDto } from "../leads/lead.service.js";
import type {
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

function canSeeLead(actor: AuthenticatedUser, lead: { ownerId: string | null }): boolean {
  return (
    actor.role === UserRole.ADMIN ||
    actor.role === UserRole.SALES_MANAGER ||
    lead.ownerId === actor.id
  );
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

function toAuthenticatedUser(user: User): AuthenticatedUser {
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    role: user.role,
    status: user.status,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt
  };
}

async function createMeetingAttentionNotification(input: {
  client: Prisma.TransactionClient;
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
    update: {}
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

async function findReusableMeetingRequestForLead(leadId: string): Promise<MeetingRequestRecord | null> {
  const candidates = await prisma.meetingRequest.findMany({
    where: {
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
  const existing = await prisma.meetingRequest.findUnique({
    where: { idempotencyKey },
    include: meetingRequestInclude
  });
  if (existing) return toMeetingRequestDto(existing);

  const lead = await prisma.lead.findUnique({
    where: { id: input.leadId },
    include: { company: true, contact: true, owner: true }
  });
  if (!lead) throw new AppError(404, "NOT_FOUND", "Lead not found");
  if (!lead.workspaceId) throw new AppError(409, "CONFLICT", "Lead has no persisted workspace");

  const activeOwner = lead.owner?.status === UserStatus.ACTIVE ? lead.owner : null;
  const requester =
    activeOwner ??
    (await prisma.user.findFirst({
      where: { role: UserRole.ADMIN, status: UserStatus.ACTIVE },
      orderBy: { createdAt: "asc" }
    }));
  if (!requester) {
    throw new AppError(409, "CONFLICT", "No active user is available to own the meeting request");
  }

  const window = nextMeetingRequestWindow();
  return createMeetingRequest(toAuthenticatedUser(requester), {
    leadId: input.leadId,
    conversationId: input.conversationId,
    ownerId: activeOwner?.id ?? requester.id,
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
  });
}

export async function createMeetingRequest(
  actor: AuthenticatedUser,
  input: CreateMeetingRequestInput
): Promise<MeetingRequestDto> {
  const existing = input.idempotencyKey
    ? await prisma.meetingRequest.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
        include: meetingRequestInclude
      })
    : null;
  if (existing) return toMeetingRequestDto(existing);

  const lead = await prisma.lead.findUnique({
    where: { id: input.leadId },
    include: { contact: true, company: true }
  });
  if (!lead) throw new AppError(404, "NOT_FOUND", "Lead not found");
  if (!canSeeLead(actor, lead)) {
    throw new AppError(403, "AUTHORIZATION_ERROR", "Cannot request meetings for this lead");
  }
  if (lead.status === "WON" || lead.status === "LOST" || lead.status === "DISQUALIFIED") {
    throw new AppError(409, "CONFLICT", "Cannot request a meeting for a terminal lead");
  }
  if (lead.contact.doNotContact) {
    throw new AppError(409, "CONFLICT", "Cannot request a meeting for a do-not-contact contact");
  }

  const requestIdempotencyKey = input.idempotencyKey ?? defaultIdempotencyKey(input);
  const existingForDefaultKey = input.idempotencyKey
    ? null
    : await prisma.meetingRequest.findUnique({
        where: { idempotencyKey: requestIdempotencyKey },
        include: meetingRequestInclude
      });
  if (existingForDefaultKey) return toMeetingRequestDto(existingForDefaultKey);

  const ownerId = input.ownerId ?? lead.ownerId ?? actor.id;
  const owner = await prisma.user.findUnique({ where: { id: ownerId } });
  if (owner?.status !== UserStatus.ACTIVE) {
    throw new AppError(404, "NOT_FOUND", "Meeting owner was not found or inactive");
  }

  const slotMinutes = input.slotMinutes ?? input.durationMinutes;
  const reusable = input.idempotencyKey ? null : await findReusableMeetingRequestForLead(lead.id);
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
          requestId: reusable.id,
          leadId: lead.id,
          conversationId: input.conversationId ?? reusable.conversationId ?? null,
          ownerId,
          title: hasSlots ? "Meeting slots need confirmation" : "Meeting scheduling needs attention",
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

    return toMeetingRequestDto(request);
  }

  const request = await prisma.$transaction(
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
        requestId: created.id,
        leadId: lead.id,
        conversationId: input.conversationId ?? null,
        ownerId,
        title: hasSlots ? "Meeting slots need confirmation" : "Meeting scheduling needs attention",
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
    ).catch(async (error: unknown) => {
      if (!isUniqueConstraintError(error)) throw error;
      const existingRequest = await prisma.meetingRequest.findUnique({
        where: { idempotencyKey: requestIdempotencyKey },
        include: meetingRequestInclude
      });
      if (!existingRequest) throw error;
      return existingRequest;
    });

  return toMeetingRequestDto(request);
}

export async function listMeetingRequests(
  actor: AuthenticatedUser,
  query: ListMeetingRequestsQuery
): Promise<MeetingRequestDto[]> {
  const requests = await prisma.meetingRequest.findMany({
    where: {
      leadId: query.leadId,
      status: query.status,
      lead:
        actor.role === UserRole.ADMIN || actor.role === UserRole.SALES_MANAGER
          ? undefined
          : { OR: [{ ownerId: actor.id }, { ownerId: null }] }
    },
    include: meetingRequestInclude,
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
    take: query.limit
  });
  return requests.map(toMeetingRequestDto);
}

export async function confirmMeetingRequest(
  actor: AuthenticatedUser,
  requestId: string,
  input: ConfirmMeetingRequestInput
): Promise<MeetingRequestDto> {
  const request = await prisma.meetingRequest.findUnique({
    where: { id: requestId },
    include: {
      ...meetingRequestInclude,
      lead: { include: { company: true, contact: true, owner: true, stage: true } }
    }
  });
  if (!request) throw new AppError(404, "NOT_FOUND", "Meeting request not found");
  if (!canSeeLead(actor, request.lead)) {
    throw new AppError(403, "AUTHORIZATION_ERROR", "Cannot confirm meetings for this lead");
  }
  if (request.status === "CONFIRMED") return toMeetingRequestDto(request);
  if (request.status === "CANCELLED") {
    throw new AppError(409, "CONFLICT", "Cannot confirm a cancelled meeting request");
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
    const updated = await prisma.meetingRequest.update({
      where: { id: request.id },
      data: {
        status: "ATTENTION_REQUIRED",
        providerSyncStatus: availability.status === "NOT_CONFIGURED" ? "NOT_CONFIGURED" : "FAILED",
        providerLastError:
          availability.unavailableReason ?? "Selected meeting slot is no longer available"
      },
      include: meetingRequestInclude
    });
    return toMeetingRequestDto(updated);
  }

  await prisma.meetingRequest.update({
    where: { id: request.id },
    data: { status: "PROVIDER_PENDING", providerSyncStatus: "PENDING", providerLastError: null }
  });

  const provider = createCalendarProvider(getCalendarConfig());
  const createResult = await provider.createMeeting({
    idempotencyKey: input.idempotencyKey ?? `meeting:${request.id}`,
    title: request.title,
    description: request.description,
    startsAt: slot.startsAt,
    endsAt: slot.endsAt,
    timeZone: slot.timeZone,
    attendees: request.lead.contact.email ? [request.lead.contact.email] : []
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
          confirmedByUserId: actor.id,
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
            ? "Google Calendar sent an invitation to the contact email."
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
          idempotencyKey: `google-calendar:meeting:${request.id}`
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
          actorUserId: actor.id,
          type: "MEETING_CONFIRMED",
          description: `Meeting confirmed for ${slot.startsAt.toISOString()}`
        }
      });
      await tx.auditEvent.create({
        data: {
          workspaceId: request.workspaceId,
          actorType: "USER",
          actorId: actor.id,
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
      return tx.meetingRequest.findUniqueOrThrow({
        where: { id: updated.id },
        include: meetingRequestInclude
      });
    },
    { maxWait: 10000, timeout: 30000 }
  );

  return toMeetingRequestDto(confirmed);
}
