import request from "supertest";
import { UserRole, UserStatus } from "@prisma/client";
import type { AuthResponse, MeetingRequestDto } from "@shilabs/shared-types";
import { createApp } from "../../app.js";
import { prisma } from "../../shared/prisma.js";
import { hashPassword } from "../auth/auth.service.js";

const app = createApp();
const password = "CorrectHorse123!";
const adminEmail = "r21-meeting-admin@example.local";
const repEmail = "r21-meeting-rep@example.local";
const companyPrefix = "R21 Meeting Company";
const originalCalendarProvider = process.env.CALENDAR_PROVIDER;

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

async function seedLead(): Promise<{ leadId: string; repId: string }> {
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
  return { leadId: lead.id, repId: rep.id };
}

describe("R21 meeting scheduling API", () => {
  beforeEach(async () => {
    process.env.CALENDAR_PROVIDER = "none";
    await cleanup();
  }, 45000);

  afterAll(async () => {
    if (originalCalendarProvider === undefined) {
      delete process.env.CALENDAR_PROVIDER;
    } else {
      process.env.CALENDAR_PROVIDER = originalCalendarProvider;
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
});
