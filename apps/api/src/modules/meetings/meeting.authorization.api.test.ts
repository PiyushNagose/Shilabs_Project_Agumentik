import { randomUUID } from "node:crypto";
import request from "supertest";
import { UserRole, UserStatus, WorkspaceRole } from "@prisma/client";
import type { AuthResponse, MeetingRequestDto } from "@shilabs/shared-types";
import { createApp } from "../../app.js";
import { prisma } from "../../shared/prisma.js";
import { hashPassword } from "../auth/auth.service.js";

const app = createApp();
const marker = `meeting-auth-${randomUUID()}`;
const password = "CorrectHorse123!";

async function createUser(label: string, role: UserRole = UserRole.ADMIN) {
  return prisma.user.create({
    data: {
      email: `${marker}-${label}@example.local`,
      passwordHash: await hashPassword(password),
      firstName: label,
      lastName: "MeetingAuth",
      role,
      status: UserStatus.ACTIVE
    }
  });
}

async function addMember(workspaceId: string, userId: string, role: WorkspaceRole) {
  return prisma.workspaceMember.create({
    data: { workspaceId, userId, role, status: "ACTIVE" }
  });
}

async function login(email: string): Promise<string> {
  const response = await request(app).post("/api/auth/login").send({ email, password }).expect(200);
  return (response.body as AuthResponse).accessToken;
}

function api(method: "get" | "post", path: string, token: string, workspaceId: string) {
  const call = method === "get" ? request(app).get(path) : request(app).post(path);
  return call.set("Authorization", `Bearer ${token}`).set("x-workspace-id", workspaceId);
}

async function createLead(workspaceId: string, ownerId: string | null, label: string) {
  const pipeline = await prisma.pipeline.create({
    data: { workspaceId, name: `${marker}-${label}`, isDefault: true }
  });
  const stage = await prisma.pipelineStage.create({
    data: {
      workspaceId,
      pipelineId: pipeline.id,
      key: `${marker}-${label}`,
      semanticKey: "NEW",
      label: "New",
      order: 1,
      position: 1,
      probability: 5
    }
  });
  const company = await prisma.company.create({
    data: { workspaceId, name: `${marker} ${label} Company` }
  });
  const contact = await prisma.contact.create({
    data: {
      workspaceId,
      companyId: company.id,
      firstName: label,
      lastName: "Customer",
      email: `${marker}-${label}@customer.local`
    }
  });
  return prisma.lead.create({
    data: {
      workspaceId,
      companyId: company.id,
      contactId: contact.id,
      ownerId,
      source: "meeting-authorization-test",
      stageId: stage.id
    }
  });
}

async function createMeeting(
  workspaceId: string,
  lead: Awaited<ReturnType<typeof createLead>>,
  requestedByUserId: string,
  label: string
) {
  return prisma.meetingRequest.create({
    data: {
      workspaceId,
      leadId: lead.id,
      contactId: lead.contactId,
      ownerId: lead.ownerId,
      requestedByUserId,
      status: "CONFIRMATION_REQUIRED",
      title: `${label} meeting`,
      timeZone: "Asia/Kolkata",
      durationMinutes: 30,
      slotMinutes: 30,
      windowStart: new Date("2026-11-01T04:30:00.000Z"),
      windowEnd: new Date("2026-11-01T05:30:00.000Z"),
      provider: "GOOGLE_CALENDAR",
      providerSyncStatus: "NOT_REQUIRED",
      zohoSyncStatus: "NOT_REQUIRED",
      partyNotificationStatus: "NOT_REQUIRED",
      idempotencyKey: `${marker}-${label}`,
      slots: {
        create: {
          startsAt: new Date("2026-11-01T04:30:00.000Z"),
          endsAt: new Date("2026-11-01T05:00:00.000Z"),
          timeZone: "Asia/Kolkata"
        }
      }
    },
    include: { slots: true }
  });
}

describe("meeting workspace and object authorization", () => {
  afterAll(async () => {
    const workspaces = await prisma.workspace.findMany({
      where: { slug: { startsWith: marker } },
      select: { id: true }
    });
    const workspaceIds = workspaces.map(({ id }) => id);
    const users = await prisma.user.findMany({
      where: { email: { startsWith: marker } },
      select: { id: true }
    });
    const userIds = users.map(({ id }) => id);

    await prisma.meetingRequest.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    await prisma.lead.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    await prisma.contact.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    await prisma.company.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    await prisma.pipelineStage.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    await prisma.pipeline.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    await prisma.authSession.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.workspaceMember.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    await prisma.workspace.deleteMany({ where: { id: { in: workspaceIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  it("prevents a manager from listing, reading, confirming, or creating against another workspace", async () => {
    const [workspaceA, workspaceB] = await Promise.all([
      prisma.workspace.create({ data: { name: `${marker}-a`, slug: `${marker}-a` } }),
      prisma.workspace.create({ data: { name: `${marker}-b`, slug: `${marker}-b` } })
    ]);
    const manager = await createUser("manager");
    const workspaceBUser = await createUser("workspace-b-user", UserRole.SALES_REP);
    await Promise.all([
      addMember(workspaceA.id, manager.id, WorkspaceRole.ADMIN),
      addMember(workspaceB.id, manager.id, WorkspaceRole.ADMIN),
      addMember(workspaceB.id, workspaceBUser.id, WorkspaceRole.SALES_REP)
    ]);
    const token = await login(manager.email);
    const [leadA, leadB] = await Promise.all([
      createLead(workspaceA.id, manager.id, "workspace-a"),
      createLead(workspaceB.id, workspaceBUser.id, "workspace-b")
    ]);
    const [meetingA, meetingB] = await Promise.all([
      createMeeting(workspaceA.id, leadA, manager.id, "workspace-a"),
      createMeeting(workspaceB.id, leadB, manager.id, "workspace-b")
    ]);

    const listResponse = await api("get", "/api/meetings/requests", token, workspaceA.id).expect(
      200
    );
    expect((listResponse.body as MeetingRequestDto[]).map(({ id }) => id)).toEqual([meetingA.id]);

    await api("get", `/api/meetings/requests/${meetingA.id}`, token, workspaceA.id).expect(200);
    await api("get", `/api/meetings/requests/${meetingB.id}`, token, workspaceA.id).expect(404);
    await api("post", `/api/meetings/requests/${meetingB.id}/confirm`, token, workspaceA.id)
      .send({ slotId: meetingB.slots[0]?.id })
      .expect(404);
    await api("post", "/api/meetings/requests", token, workspaceA.id)
      .send({
        leadId: leadB.id,
        title: "Foreign meeting",
        timeZone: "Asia/Kolkata",
        windowStart: "2026-11-02T10:00:00+05:30",
        windowEnd: "2026-11-02T11:00:00+05:30",
        durationMinutes: 30,
        idempotencyKey: `${marker}-foreign-create`
      })
      .expect(404);
    await api("post", "/api/meetings/requests", token, workspaceA.id)
      .send({
        leadId: leadA.id,
        ownerId: workspaceBUser.id,
        title: "Foreign owner meeting",
        timeZone: "Asia/Kolkata",
        windowStart: "2026-11-02T10:00:00+05:30",
        windowEnd: "2026-11-02T11:00:00+05:30",
        durationMinutes: 30,
        idempotencyKey: `${marker}-foreign-owner`
      })
      .expect(404);

    expect(await prisma.meetingRequest.count({ where: { workspaceId: workspaceA.id } })).toBe(1);
    expect(await prisma.meetingRequest.count({ where: { workspaceId: workspaceB.id } })).toBe(1);
  });

  it("limits sales representatives to assigned and unassigned leads in their active workspace", async () => {
    const workspace = await prisma.workspace.create({
      data: { name: `${marker}-lead-access`, slug: `${marker}-lead-access` }
    });
    const [rep, otherRep] = await Promise.all([
      createUser("rep", UserRole.SALES_REP),
      createUser("other-rep", UserRole.SALES_REP)
    ]);
    await Promise.all([
      addMember(workspace.id, rep.id, WorkspaceRole.SALES_REP),
      addMember(workspace.id, otherRep.id, WorkspaceRole.SALES_REP)
    ]);
    const token = await login(rep.email);
    const [ownLead, unassignedLead, otherLead] = await Promise.all([
      createLead(workspace.id, rep.id, "own"),
      createLead(workspace.id, null, "unassigned"),
      createLead(workspace.id, otherRep.id, "other")
    ]);
    const [ownMeeting, unassignedMeeting, otherMeeting] = await Promise.all([
      createMeeting(workspace.id, ownLead, rep.id, "own"),
      createMeeting(workspace.id, unassignedLead, rep.id, "unassigned"),
      createMeeting(workspace.id, otherLead, otherRep.id, "other")
    ]);

    const response = await api("get", "/api/meetings/requests", token, workspace.id).expect(200);
    const visibleIds = (response.body as MeetingRequestDto[]).map(({ id }) => id);
    expect(visibleIds).toEqual(expect.arrayContaining([ownMeeting.id, unassignedMeeting.id]));
    expect(visibleIds).not.toContain(otherMeeting.id);
    await api("get", `/api/meetings/requests/${otherMeeting.id}`, token, workspace.id).expect(404);
  });
});
