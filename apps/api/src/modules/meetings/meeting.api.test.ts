import request from "supertest";
import {
  ExternalRecordEntityType,
  IntegrationProvider,
  UserRole,
  UserStatus
} from "@prisma/client";
import type { AuthResponse, MeetingRequestDto } from "@shilabs/shared-types";
import { vi } from "vitest";
import { createApp } from "../../app.js";
import { prisma } from "../../shared/prisma.js";
import { hashPassword } from "../auth/auth.service.js";
import { confirmMeetingFromCustomerReply } from "./meeting.service.js";

const app = createApp();
const password = "CorrectHorse123!";
const adminEmail = "r21-meeting-admin@example.local";
const repEmail = "r21-meeting-rep@example.local";
const companyPrefix = "R21 Meeting Company";
const originalCalendarProvider = process.env.CALENDAR_PROVIDER;
const originalGoogleCalendarClientId = process.env.GOOGLE_CALENDAR_CLIENT_ID;
const originalGoogleCalendarClientSecret = process.env.GOOGLE_CALENDAR_CLIENT_SECRET;
const originalGoogleCalendarRefreshToken = process.env.GOOGLE_CALENDAR_REFRESH_TOKEN;
const originalGoogleCalendarId = process.env.GOOGLE_CALENDAR_ID;
const originalGoogleCalendarScope = process.env.GOOGLE_CALENDAR_SCOPE;

async function cleanup(): Promise<void> {
  const companies = await prisma.company.findMany({
    where: { name: { startsWith: companyPrefix } },
    select: { id: true }
  });
  const companyIds = companies.map((company) => company.id);
  const contacts = await prisma.contact.findMany({
    where: { companyId: { in: companyIds } },
    select: { id: true }
  });
  const contactIds = contacts.map((contact) => contact.id);
  const leads = await prisma.lead.findMany({
    where: { companyId: { in: companyIds } },
    select: { id: true }
  });
  const leadIds = leads.map((lead) => lead.id);
  const meetingRequests = await prisma.meetingRequest.findMany({
    where: { leadId: { in: leadIds } },
    select: { id: true }
  });
  const meetingRequestIds = meetingRequests.map((meetingRequest) => meetingRequest.id);

  await prisma.authSession.deleteMany({
    where: { user: { email: { in: [adminEmail, repEmail] } } }
  });
  await prisma.domainEventOutbox.deleteMany({
    where: { aggregateType: "MeetingRequest", aggregateId: { in: meetingRequestIds } }
  });
  await prisma.internalNotification.deleteMany({
    where: { sourceEntityType: "MeetingRequest", meetingRequestId: { in: meetingRequestIds } }
  });
  await prisma.meetingSlot.deleteMany({
    where: { meetingRequestId: { in: meetingRequestIds } }
  });
  await prisma.externalRecordMapping.deleteMany({
    where: {
      OR: [
        {
          provider: IntegrationProvider.GOOGLE_CALENDAR,
          entityType: ExternalRecordEntityType.MEETING,
          localEntityId: { in: meetingRequestIds }
        },
        {
          provider: IntegrationProvider.GOOGLE_CALENDAR,
          entityType: ExternalRecordEntityType.MEETING,
          externalRecordId:
            "meeting3dd927f3a538d4ede821139de988ef03351c7194e369e4f3ed6b79956e73d2e6"
        }
      ]
    }
  });
  await prisma.meetingRequest.deleteMany({ where: { id: { in: meetingRequestIds } } });
  await prisma.message.deleteMany({ where: { conversation: { leadId: { in: leadIds } } } });
  await prisma.conversation.deleteMany({ where: { leadId: { in: leadIds } } });
  await prisma.activity.deleteMany({ where: { leadId: { in: leadIds } } });
  await prisma.auditEvent.deleteMany({
    where: {
      OR: [
        { entityId: { in: meetingRequestIds } },
        { entityId: { in: leadIds } },
        { entityId: { in: contactIds } },
        { entityId: { in: companyIds } }
      ]
    }
  });
  await prisma.lead.deleteMany({ where: { id: { in: leadIds } } });
  await prisma.contact.deleteMany({ where: { id: { in: contactIds } } });
  await prisma.company.deleteMany({ where: { id: { in: companyIds } } });
  await prisma.user.deleteMany({
    where: { email: { in: [adminEmail, repEmail] } }
  });
}

async function login(email: string): Promise<string> {
  const response = await request(app).post("/api/auth/login").send({ email, password }).expect(200);
  return (response.body as AuthResponse).accessToken;
}

async function seedLead(): Promise<{
  leadId: string;
  contactId: string;
  adminId: string;
  repId: string;
}> {
  const workspace = await prisma.workspace.findUniqueOrThrow({ where: { slug: "default" } });
  const passwordHash = await hashPassword(password);
  const [admin, rep] = await Promise.all([
    prisma.user.create({
      data: {
        email: adminEmail,
        passwordHash,
        firstName: "R21",
        lastName: "Admin",
        role: UserRole.ADMIN,
        status: UserStatus.ACTIVE
      }
    }),
    prisma.user.create({
      data: {
        email: repEmail,
        passwordHash,
        firstName: "R21",
        lastName: "Rep",
        role: UserRole.SALES_REP,
        status: UserStatus.ACTIVE
      }
    })
  ]);
  await prisma.workspaceMember.createMany({
    data: [
      { workspaceId: workspace.id, userId: admin.id, role: "ADMIN", status: "ACTIVE" },
      { workspaceId: workspace.id, userId: rep.id, role: "SALES_REP", status: "ACTIVE" }
    ]
  });
  const stage = await prisma.pipelineStage.findUniqueOrThrow({ where: { key: "NEW" } });
  const company = await prisma.company.create({
    data: {
      workspaceId: workspace.id,
      name: `${companyPrefix} Primary`,
      website: "https://r21-meeting.example"
    }
  });
  const contact = await prisma.contact.create({
    data: {
      workspaceId: workspace.id,
      companyId: company.id,
      firstName: "R21",
      lastName: "Customer",
      email: "r21.customer@example.local"
    }
  });
  const lead = await prisma.lead.create({
    data: {
      workspaceId: workspace.id,
      companyId: company.id,
      contactId: contact.id,
      ownerId: rep.id,
      source: "test",
      stageId: stage.id,
      requirement: "Needs a scheduling discussion",
      serviceInterest: "AI sales automation"
    }
  });
  expect(admin.id).toBeTruthy();
  return { leadId: lead.id, contactId: contact.id, adminId: admin.id, repId: rep.id };
}

describe("R21 meeting scheduling API", () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    process.env.CALENDAR_PROVIDER = "none";
    await cleanup();
  }, 90000);

  afterAll(async () => {
    if (originalCalendarProvider === undefined) {
      delete process.env.CALENDAR_PROVIDER;
    } else {
      process.env.CALENDAR_PROVIDER = originalCalendarProvider;
    }
    if (originalGoogleCalendarClientId === undefined) {
      delete process.env.GOOGLE_CALENDAR_CLIENT_ID;
    } else {
      process.env.GOOGLE_CALENDAR_CLIENT_ID = originalGoogleCalendarClientId;
    }
    if (originalGoogleCalendarClientSecret === undefined) {
      delete process.env.GOOGLE_CALENDAR_CLIENT_SECRET;
    } else {
      process.env.GOOGLE_CALENDAR_CLIENT_SECRET = originalGoogleCalendarClientSecret;
    }
    if (originalGoogleCalendarRefreshToken === undefined) {
      delete process.env.GOOGLE_CALENDAR_REFRESH_TOKEN;
    } else {
      process.env.GOOGLE_CALENDAR_REFRESH_TOKEN = originalGoogleCalendarRefreshToken;
    }
    if (originalGoogleCalendarId === undefined) {
      delete process.env.GOOGLE_CALENDAR_ID;
    } else {
      process.env.GOOGLE_CALENDAR_ID = originalGoogleCalendarId;
    }
    if (originalGoogleCalendarScope === undefined) {
      delete process.env.GOOGLE_CALENDAR_SCOPE;
    } else {
      process.env.GOOGLE_CALENDAR_SCOPE = originalGoogleCalendarScope;
    }
    await cleanup();
    await prisma.$disconnect();
  }, 90000);

  it("persists a truthful attention state when calendar availability is not configured", async () => {
    const seeded = await seedLead();
    const adminToken = await login(adminEmail);

    const response = await request(app)
      .post("/api/meetings/requests")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        leadId: seeded.leadId,
        ownerId: seeded.repId,
        title: "Discuss AI sales automation",
        timeZone: "Asia/Kolkata",
        windowStart: "2026-09-24T09:00:00+05:30",
        windowEnd: "2026-09-24T17:00:00+05:30",
        durationMinutes: 30,
        idempotencyKey: "r21-meeting-request-primary"
      })
      .expect(201);
    const meeting = response.body as MeetingRequestDto;

    expect(meeting).toMatchObject({
      leadId: seeded.leadId,
      ownerId: seeded.repId,
      status: "ATTENTION_REQUIRED",
      providerSyncStatus: "NOT_REQUIRED",
      providerLastError: "Calendar provider is not configured",
      slots: []
    });

    const [activityCount, notificationCount, eventCount] = await Promise.all([
      prisma.activity.count({ where: { leadId: seeded.leadId, type: "MEETING_REQUESTED" } }),
      prisma.internalNotification.count({
        where: { meetingRequestId: meeting.id, type: "MEETING_CONFIRMATION" }
      }),
      prisma.domainEventOutbox.count({
        where: { aggregateType: "MeetingRequest", aggregateId: meeting.id }
      })
    ]);
    expect(activityCount).toBe(1);
    expect(notificationCount).toBe(1);
    expect(eventCount).toBe(1);

    const listResponse = await request(app)
      .get(`/api/meetings/requests?leadId=${seeded.leadId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);
    expect((listResponse.body as MeetingRequestDto[]).map((item) => item.id)).toContain(meeting.id);
  }, 45000);

  it("cancels an unconfirmed meeting without claiming a provider cancellation", async () => {
    const seeded = await seedLead();
    const adminToken = await login(adminEmail);
    const created = await request(app)
      .post("/api/meetings/requests")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        leadId: seeded.leadId,
        ownerId: seeded.repId,
        title: "Initial discovery",
        timeZone: "Asia/Kolkata",
        windowStart: "2026-11-24T09:00:00+05:30",
        windowEnd: "2026-11-24T17:00:00+05:30",
        durationMinutes: 30,
        idempotencyKey: "r21-meeting-cancel-unconfirmed"
      })
      .expect(201);
    const meeting = created.body as MeetingRequestDto;
    const cancelled = await request(app)
      .post(`/api/meetings/requests/${meeting.id}/cancel`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ reason: "Customer asked to postpone discovery" })
      .expect(200);
    expect((cancelled.body as MeetingRequestDto).status).toBe("CANCELLED");
    const repeated = await request(app)
      .post(`/api/meetings/requests/${meeting.id}/cancel`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ reason: "Customer asked to postpone discovery" })
      .expect(200);
    expect((repeated.body as MeetingRequestDto).status).toBe("CANCELLED");
    expect(await prisma.activity.count({ where: { leadId: seeded.leadId, title: "Meeting cancelled" } })).toBe(1);
  }, 45000);

  it("reuses an R10-created meeting request, hydrates slots, and confirms idempotently", async () => {
    process.env.CALENDAR_PROVIDER = "google";
    process.env.GOOGLE_CALENDAR_CLIENT_ID = "google-client";
    process.env.GOOGLE_CALENDAR_CLIENT_SECRET = "google-secret";
    process.env.GOOGLE_CALENDAR_REFRESH_TOKEN = "google-refresh";
    process.env.GOOGLE_CALENDAR_ID = "primary";
    process.env.GOOGLE_CALENDAR_SCOPE =
      "https://www.googleapis.com/auth/calendar.freebusy https://www.googleapis.com/auth/calendar.events";

    let eventInsertCount = 0;
    let eventDeleteCount = 0;
    let eventPatchCount = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url === "https://oauth2.googleapis.com/token") {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              access_token: "google-access-token",
              expires_in: 3600,
              scope: process.env.GOOGLE_CALENDAR_SCOPE,
              token_type: "Bearer"
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          )
        );
      }
      if (url === "https://www.googleapis.com/calendar/v3/freeBusy") {
        return Promise.resolve(
          new Response(JSON.stringify({ calendars: { primary: { busy: [] } } }), {
            status: 200,
            headers: { "Content-Type": "application/json" }
          })
        );
      }
      if (url.includes("/events/") && init?.method === "DELETE") {
        eventDeleteCount += 1;
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      if (url.includes("/events/") && init?.method === "PATCH") {
        eventPatchCount += 1;
        return Promise.resolve(Response.json({ id: "rescheduled" }));
      }
      if (url.includes("/events?sendUpdates=all")) {
        eventInsertCount += 1;
        const rawBody: unknown = typeof init?.body === "string" ? JSON.parse(init.body) : {};
        const requestBody =
          rawBody && typeof rawBody === "object" && "id" in rawBody
            ? { id: String(rawBody.id) }
            : { id: "" };
        return Promise.resolve(
          new Response(
            JSON.stringify({
              id: requestBody.id,
              htmlLink: `https://calendar.google.test/insert/${requestBody.id}`
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          )
        );
      }
      if (url.includes("/events/")) {
        const eventId = decodeURIComponent(url.split("/events/")[1] ?? "");
        return Promise.resolve(
          new Response(
            JSON.stringify({
              id: eventId,
              status: "confirmed",
              htmlLink: `https://calendar.google.test/verified/${eventId}`,
              organizer: { email: "calendar-owner@example.test" }
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          )
        );
      }
      return Promise.resolve(new Response("{}", { status: 404 }));
    });

    const seeded = await seedLead();
    const adminToken = await login(adminEmail);
    const workspace = await prisma.workspace.findUniqueOrThrow({ where: { slug: "default" } });
    const existing = await prisma.meetingRequest.create({
      data: {
        workspaceId: workspace.id,
        leadId: seeded.leadId,
        contactId: seeded.contactId,
        conversationId: null,
        ownerId: seeded.repId,
        requestedByUserId: seeded.adminId,
        status: "ATTENTION_REQUIRED",
        title: "Meeting with R21 Customer",
        description: "Prospect requested scheduling from an inbound reply",
        timeZone: "Asia/Kolkata",
        durationMinutes: 30,
        slotMinutes: 30,
        windowStart: new Date("2026-09-24T03:30:00.000Z"),
        windowEnd: new Date("2026-09-24T11:30:00.000Z"),
        provider: "GOOGLE_CALENDAR",
        providerSyncStatus: "NOT_REQUIRED",
        providerLastError: "Google Calendar is missing required configuration",
        zohoSyncStatus: "NOT_REQUIRED",
        partyNotificationStatus: "NOT_REQUIRED",
        idempotencyKey: "meeting-request:reply-processing:r21-reply-run"
      }
    });

    const response = await request(app)
      .post("/api/meetings/requests")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        leadId: seeded.leadId,
        ownerId: seeded.repId,
        title: "Meeting with R21 Customer",
        timeZone: "Asia/Kolkata",
        windowStart: "2026-09-30T10:00:00+05:30",
        windowEnd: "2026-09-30T11:00:00+05:30",
        durationMinutes: 30
      })
      .expect(201);
    const meeting = response.body as MeetingRequestDto;

    expect(meeting.id).toBe(existing.id);
    expect(meeting.status).toBe("CONFIRMATION_REQUIRED");
    expect(meeting.providerLastError).toBeNull();
    expect(meeting.slots).toHaveLength(2);
    expect(await prisma.meetingRequest.count({ where: { leadId: seeded.leadId } })).toBe(1);

    const repeatedResponse = await request(app)
      .post("/api/meetings/requests")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        leadId: seeded.leadId,
        ownerId: seeded.repId,
        title: "Meeting with R21 Customer",
        timeZone: "Asia/Kolkata",
        windowStart: "2026-09-30T10:00:00+05:30",
        windowEnd: "2026-09-30T11:00:00+05:30",
        durationMinutes: 30
      })
      .expect(201);
    expect((repeatedResponse.body as MeetingRequestDto).id).toBe(existing.id);
    expect(await prisma.meetingRequest.count({ where: { leadId: seeded.leadId } })).toBe(1);

    const listResponse = await request(app)
      .get(`/api/meetings/requests?leadId=${seeded.leadId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);
    const hydrated = listResponse.body as MeetingRequestDto[];
    expect(hydrated).toHaveLength(1);
    expect(hydrated[0]?.slots).toHaveLength(2);

    const slotId = hydrated[0]?.slots[0]?.id;
    expect(slotId).toBeTruthy();
    const confirmedResponse = await request(app)
      .post(`/api/meetings/requests/${existing.id}/confirm`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ slotId, idempotencyKey: "confirm-r21-meeting" })
      .expect(200);
    const confirmedMeeting = confirmedResponse.body as MeetingRequestDto;
    expect(confirmedMeeting.status).toBe("CONFIRMED");
    expect(confirmedMeeting.providerCalendarId).toBe("primary");
    expect(confirmedMeeting.providerOrganizerEmail).toBe("calendar-owner@example.test");
    expect(confirmedMeeting.providerMeetingUrl).toContain("https://calendar.google.test/verified/");
    await expect(
      prisma.internalNotification.findFirstOrThrow({
        where: { meetingRequestId: existing.id },
        orderBy: { createdAt: "desc" }
      })
    ).resolves.toMatchObject({
      workspaceId: "workspace_default",
      status: "ACKNOWLEDGED",
      acknowledgedByUserId: seeded.adminId
    });

    const repeatedConfirmResponse = await request(app)
      .post(`/api/meetings/requests/${existing.id}/confirm`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ slotId, idempotencyKey: "confirm-r21-meeting" })
      .expect(200);
    expect((repeatedConfirmResponse.body as MeetingRequestDto).status).toBe("CONFIRMED");
    expect(eventInsertCount).toBe(1);

    const repeatedSlotRequestAfterConfirmation = await request(app)
      .post("/api/meetings/requests")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        leadId: seeded.leadId,
        ownerId: seeded.repId,
        title: "Meeting with R21 Customer",
        timeZone: "Asia/Kolkata",
        windowStart: "2026-09-30T10:00:00+05:30",
        windowEnd: "2026-09-30T11:00:00+05:30",
        durationMinutes: 30
      })
      .expect(201);
    expect((repeatedSlotRequestAfterConfirmation.body as MeetingRequestDto).status).toBe(
      "CONFIRMATION_REQUIRED"
    );
    expect(await prisma.meetingRequest.count({ where: { leadId: seeded.leadId } })).toBe(2);
    const startsAt = new Date(Date.now() + 7 * 86400000);
    startsAt.setUTCMinutes(0, 0, 0);
    const endsAt = new Date(startsAt.getTime() + 30 * 60000);
    const rescheduleBody = { startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString(), reason: "Customer requested next week" };
    const rescheduled = await request(app)
      .post(`/api/meetings/requests/${existing.id}/reschedule`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send(rescheduleBody)
      .expect(200);
    const changedMeeting = rescheduled.body as MeetingRequestDto;
    expect(changedMeeting.providerMeetingId).toBe(confirmedMeeting.providerMeetingId);
    expect(changedMeeting.slots.find((slot) => slot.id === changedMeeting.selectedSlotId)?.startsAt).toBe(startsAt.toISOString());
    await request(app)
      .post(`/api/meetings/requests/${existing.id}/reschedule`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send(rescheduleBody)
      .expect(200);
    expect(eventPatchCount).toBe(1);
    expect(await prisma.domainEventOutbox.count({ where: { aggregateId: existing.id, eventType: "MEETING_REMINDER_DUE" } })).toBeGreaterThan(0);
    const cancelledResponse = await request(app)
      .post(`/api/meetings/requests/${existing.id}/cancel`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ reason: "Customer requested a later appointment" })
      .expect(200);
    expect((cancelledResponse.body as MeetingRequestDto).status).toBe("CANCELLED");
    await request(app)
      .post(`/api/meetings/requests/${existing.id}/cancel`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ reason: "Customer requested a later appointment" })
      .expect(200);
    expect(eventDeleteCount).toBe(1);

    const duplicateDefaultKeyRequest = await request(app)
      .post("/api/meetings/requests")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        leadId: seeded.leadId,
        ownerId: seeded.repId,
        title: "Meeting with R21 Customer",
        timeZone: "Asia/Kolkata",
        windowStart: "2026-09-30T10:00:00+05:30",
        windowEnd: "2026-09-30T11:00:00+05:30",
        durationMinutes: 30
      })
      .expect(201);
    expect((duplicateDefaultKeyRequest.body as MeetingRequestDto).id).toBe(
      (repeatedSlotRequestAfterConfirmation.body as MeetingRequestDto).id
    );
    expect(await prisma.meetingRequest.count({ where: { leadId: seeded.leadId } })).toBe(2);
  }, 180000);

  it("records a meeting outcome once and preserves human ownership", async () => {
    const seeded = await seedLead();
    const adminToken = await login(adminEmail);
    const startsAt = new Date(Date.now() - 3600000);
    const endsAt = new Date(Date.now() - 1800000);
    const meeting = await prisma.meetingRequest.create({ data: {
      workspaceId: "workspace_default", leadId: seeded.leadId, contactId: seeded.contactId,
      requestedByUserId: seeded.adminId, ownerId: seeded.repId,
      status: "CONFIRMED", title: "Discovery discussion", timeZone: "Asia/Kolkata",
      durationMinutes: 30, slotMinutes: 30, windowStart: startsAt, windowEnd: endsAt,
      provider: "GOOGLE_CALENDAR", providerMeetingId: "outcome-test-event",
      idempotencyKey: "meeting-outcome-fixture",
      slots: { create: { startsAt, endsAt, timeZone: "Asia/Kolkata", status: "SELECTED" } }
    }, include: { slots: true } });
    await prisma.meetingRequest.update({ where: { id: meeting.id }, data: { selectedSlotId: meeting.slots[0]?.id } });
    await prisma.lead.update({ where: { id: seeded.leadId }, data: {
      automationOwnershipState: "HUMAN_REQUIRED", nextAction: "Prepare for confirmed meeting", nextActionAt: startsAt
    } });
    const body = { outcome: "COMPLETED", notes: "Customer confirmed the implementation scope; share a proposal next.", idempotencyKey: "outcome-fixture-save" };
    for (let index = 0; index < 2; index += 1) {
      const response = await request(app).post(`/api/meetings/requests/${meeting.id}/outcome`)
        .set("Authorization", `Bearer ${adminToken}`).send(body).expect(200);
      expect((response.body as MeetingRequestDto).outcome).toBe("COMPLETED");
    }
    expect(await prisma.activity.count({ where: { sourceId: meeting.id, title: "Meeting completed" } })).toBe(1);
    await expect(prisma.lead.findUnique({ where: { id: seeded.leadId } })).resolves.toMatchObject({
      automationOwnershipState: "HUMAN_REQUIRED", nextActionAt: null,
      nextAction: "Review meeting notes and agree next steps"
    });
    await request(app).post(`/api/meetings/requests/${meeting.id}/cancel`)
      .set("Authorization", `Bearer ${adminToken}`).send({ reason: "Too late to cancel" }).expect(409);
  }, 45000);

  it("confirms an explicitly offered customer time without starting AI", async () => {
    process.env.CALENDAR_PROVIDER = "google";
    process.env.GOOGLE_CALENDAR_CLIENT_ID = "google-client";
    process.env.GOOGLE_CALENDAR_CLIENT_SECRET = "google-secret";
    process.env.GOOGLE_CALENDAR_REFRESH_TOKEN = "google-refresh";
    process.env.GOOGLE_CALENDAR_ID = "primary";
    process.env.GOOGLE_CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.freebusy https://www.googleapis.com/auth/calendar.events";
    let inserts = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes("oauth2.googleapis.com")) return Promise.resolve(Response.json({
        access_token: "test-token", expires_in: 3600, scope: process.env.GOOGLE_CALENDAR_SCOPE
      }));
      if (url.endsWith("/freeBusy")) return Promise.resolve(Response.json({ calendars: { primary: { busy: [] } } }));
      if (init?.method === "POST" && url.includes("/events?")) {
        inserts += 1;
        const body = (typeof init.body === "string" ? JSON.parse(init.body) : {}) as { id: string };
        return Promise.resolve(Response.json({ id: body.id, htmlLink: `https://calendar.google.test/${body.id}` }));
      }
      const id = decodeURIComponent(url.split("/events/")[1] ?? "");
      return Promise.resolve(Response.json({ id, status: "confirmed", htmlLink: `https://calendar.google.test/${id}` }));
    });
    const seeded = await seedLead();
    const adminToken = await login(adminEmail);
    const start = new Date("2026-12-01T09:00:00+05:30");
    const end = new Date(start.getTime() + 1800000);
    const created = await request(app).post("/api/meetings/requests")
      .set("Authorization", `Bearer ${adminToken}`).send({
        leadId: seeded.leadId, ownerId: seeded.repId, title: "Customer confirmed discussion",
        timeZone: "Asia/Kolkata", windowStart: start.toISOString(), windowEnd: end.toISOString(), durationMinutes: 30
      }).expect(201);
    const meeting = created.body as MeetingRequestDto;
    const conversation = await prisma.conversation.create({ data: {
      workspaceId: "workspace_default", leadId: seeded.leadId, channel: "EMAIL", mode: "HUMAN"
    } });
    const inbound = await prisma.message.create({ data: {
      workspaceId: "workspace_default", conversationId: conversation.id,
      senderType: "PROSPECT", direction: "INBOUND", body: "Confirm meeting 2026-12-01 09:00"
    } });
    const input = { leadId: seeded.leadId, conversationId: conversation.id, messageId: inbound.id };
    await expect(confirmMeetingFromCustomerReply(input)).resolves.toBe(false);
    await prisma.message.create({ data: {
      workspaceId: "workspace_default", conversationId: conversation.id,
      senderType: "USER", direction: "OUTBOUND",
      body: "Please reply: Confirm meeting 2026-12-01 09:00", sentAt: new Date(Date.now() - 60000),
      createdAt: new Date(inbound.createdAt.getTime() - 60000), deliveryStatus: "SENT"
    } });
    await prisma.lead.update({ where: { id: seeded.leadId }, data: { automationOwnershipState: "HUMAN_REQUIRED" } });
    await expect(confirmMeetingFromCustomerReply(input)).resolves.toBe(true);
    await expect(confirmMeetingFromCustomerReply(input)).resolves.toBe(true);
    expect(inserts).toBe(1);
    await expect(prisma.meetingRequest.findUnique({ where: { id: meeting.id } })).resolves.toMatchObject({
      status: "CONFIRMED", confirmedByUserId: null
    });
    await expect(prisma.lead.findUnique({ where: { id: seeded.leadId } })).resolves.toMatchObject({ automationOwnershipState: "HUMAN_REQUIRED" });
  }, 45000);
});
