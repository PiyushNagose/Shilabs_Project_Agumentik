import request from "supertest";
import { UserRole, UserStatus } from "@prisma/client";
import type {
  AuthResponse,
  CalendarAvailabilityResultDto,
  CalendarHealthDto
} from "@shilabs/shared-types";
import { createApp } from "../../app.js";
import { prisma } from "../../shared/prisma.js";
import { hashPassword } from "../auth/auth.service.js";

const app = createApp();
const password = "CorrectHorse123!";
const adminEmail = "r20-calendar-admin@example.local";
const repEmail = "r20-calendar-rep@example.local";
const otherRepEmail = "r20-calendar-other@example.local";
const originalCalendarProvider = process.env.CALENDAR_PROVIDER;

async function cleanup(): Promise<void> {
  await prisma.authSession.deleteMany({
    where: { user: { email: { in: [adminEmail, repEmail, otherRepEmail] } } }
  });
  await prisma.user.deleteMany({
    where: { email: { in: [adminEmail, repEmail, otherRepEmail] } }
  });
}

async function login(email: string): Promise<string> {
  const response = await request(app).post("/api/auth/login").send({ email, password }).expect(200);
  return (response.body as AuthResponse).accessToken;
}

async function seedUsers(): Promise<{ adminId: string; repId: string; otherRepId: string }> {
  const passwordHash = await hashPassword(password);
  const [admin, rep, otherRep] = await Promise.all([
    prisma.user.create({
      data: {
        email: adminEmail,
        passwordHash,
        firstName: "R20",
        lastName: "Admin",
        role: UserRole.ADMIN,
        status: UserStatus.ACTIVE
      }
    }),
    prisma.user.create({
      data: {
        email: repEmail,
        passwordHash,
        firstName: "R20",
        lastName: "Rep",
        role: UserRole.SALES_REP,
        status: UserStatus.ACTIVE
      }
    }),
    prisma.user.create({
      data: {
        email: otherRepEmail,
        passwordHash,
        firstName: "R20",
        lastName: "Other",
        role: UserRole.SALES_REP,
        status: UserStatus.ACTIVE
      }
    })
  ]);
  return { adminId: admin.id, repId: rep.id, otherRepId: otherRep.id };
}

function availabilityBody(ownerUserId: string) {
  return {
    ownerUserId,
    timeZone: "Asia/Kolkata",
    windowStart: "2026-09-23T09:00:00+05:30",
    windowEnd: "2026-09-23T17:00:00+05:30",
    slotMinutes: 30
  };
}

describe("R20 calendar API", () => {
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

  it("protects health and returns truthful not-configured state", async () => {
    await seedUsers();
    const adminToken = await login(adminEmail);
    const repToken = await login(repEmail);

    await request(app).get("/api/calendar/health").expect(401);
    await request(app)
      .get("/api/calendar/health")
      .set("Authorization", `Bearer ${repToken}`)
      .expect(403);

    const response = await request(app)
      .get("/api/calendar/health")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);
    const health = response.body as CalendarHealthDto;

    expect(health).toMatchObject({
      provider: "NONE",
      status: "NOT_CONFIGURED",
      configured: false,
      defaultTimeZone: "Asia/Kolkata"
    });
  }, 45000);

  it("validates availability input and does not fabricate slots", async () => {
    const users = await seedUsers();
    const adminToken = await login(adminEmail);

    await request(app)
      .post("/api/calendar/availability")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ ...availabilityBody(users.repId), timeZone: "Invalid/Zone" })
      .expect(400);

    const response = await request(app)
      .post("/api/calendar/availability")
      .set("Authorization", `Bearer ${adminToken}`)
      .send(availabilityBody(users.repId))
      .expect(200);
    const availability = response.body as CalendarAvailabilityResultDto;

    expect(availability).toMatchObject({
      provider: "NONE",
      status: "NOT_CONFIGURED",
      timeZone: "Asia/Kolkata",
      slotMinutes: 30,
      slots: [],
      unavailableReason: "Calendar provider is not configured"
    });
  }, 45000);

  it("prevents sales reps from checking another user's availability", async () => {
    const users = await seedUsers();
    const repToken = await login(repEmail);

    await request(app)
      .post("/api/calendar/availability")
      .set("Authorization", `Bearer ${repToken}`)
      .send(availabilityBody(users.otherRepId))
      .expect(403);

    await request(app)
      .post("/api/calendar/availability")
      .set("Authorization", `Bearer ${repToken}`)
      .send(availabilityBody(users.repId))
      .expect(200);
  }, 45000);
});
