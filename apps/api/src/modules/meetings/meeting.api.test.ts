import request from "supertest";
import { ExternalRecordEntityType, IntegrationProvider, UserRole, UserStatus } from "@prisma/client";
import type { AuthResponse, MeetingRequestDto } from "@shilabs/shared-types";
import { vi } from "vitest";
import { createApp } from "../../app.js";
import { prisma } from "../../shared/prisma.js";
import { hashPassword } from "../auth/auth.service.js";

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
  await prisma.authSession.deleteMany({
    where: { user: { email: { in: [adminEmail, repEmail] } } }
  });
  await prisma.domainEventOutbox.deleteMany({
    where: { aggregateType: "MeetingRequest" }
  });
  await prisma.internalNotification.deleteMany({
    where: { sourceEntityType: "MeetingRequest" }
  });
  await prisma.meetingSlot.deleteMany({
    where: { meetingRequest: { lead: { company: { name: { startsWith: companyPrefix } } } } }
  });
  await prisma.externalRecordMapping.deleteMany({
    where: {
      provider: IntegrationProvider.GOOGLE_CALENDAR,
      entityType: ExternalRecordEntityType.MEETING,
      externalRecordId:
        "meeting3dd927f3a538d4ede821139de988ef03351c7194e369e4f3ed6b79956e73d2e6"
    }
  });
  await prisma.meetingRequest.deleteMany({
    where: { lead: { company: { name: { startsWith: companyPrefix } } } }
  });
  await prisma.activity.deleteMany({
    where: { lead: { company: { name: { startsWith: companyPrefix } } } }
  });
  await prisma.auditEvent.deleteMany({
    where: { entityType: "MeetingRequest" }
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
  const stage = await prisma.pipelineStage.findUniqueOrThrow({ where: { key: "NEW" } });
  const company = await prisma.company.create({
    data: { name: `${companyPrefix} Primary`, website: "https://r21-meeting.example" }
  });
  const contact = await prisma.contact.create({
    data: {
      companyId: company.id,
      firstName: "R21",
      lastName: "Customer",
      email: "r21.customer@example.local"
    }
  });
  const lead = await prisma.lead.create({
    data: {
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
  }, 45000);

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
  }, 45000);

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

  it("reuses an R10-created meeting request, hydrates slots, and confirms idempotently", async () => {
    process.env.CALENDAR_PROVIDER = "google";
    process.env.GOOGLE_CALENDAR_CLIENT_ID = "google-client";
    process.env.GOOGLE_CALENDAR_CLIENT_SECRET = "google-secret";
    process.env.GOOGLE_CALENDAR_REFRESH_TOKEN = "google-refresh";
    process.env.GOOGLE_CALENDAR_ID = "primary";
    process.env.GOOGLE_CALENDAR_SCOPE =
      "https://www.googleapis.com/auth/calendar.freebusy https://www.googleapis.com/auth/calendar.events";

    let eventInsertCount = 0;
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
      if (url.includes("/events?sendUpdates=none")) {
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
    const existing = await prisma.meetingRequest.create({
      data: {
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
  }, 45000);
});
