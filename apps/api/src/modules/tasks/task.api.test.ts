import { randomUUID } from "node:crypto";
import request from "supertest";
import { UserRole, UserStatus, WorkspaceRole } from "@prisma/client";
import type { ActivityDto, AuthResponse, TaskDto } from "@shilabs/shared-types";
import { createApp } from "../../app.js";
import { prisma } from "../../shared/prisma.js";
import { hashPassword } from "../auth/auth.service.js";
import { resolveRealtimeEventScope } from "../realtime/realtime.service.js";
import { createAutomationTask } from "./task.service.js";

const app = createApp();
const marker = "phase2-task-test";
const emails = ["phase2-a@example.local", "phase2-b@example.local"] as const;
const slugs = ["phase2-task-a", "phase2-task-b"] as const;

async function login(email: string): Promise<string> {
  const response = await request(app)
    .post("/api/auth/login")
    .send({ email, password: "CorrectHorse123!" })
    .expect(200);
  return (response.body as AuthResponse).accessToken;
}

async function createLead(workspaceId: string, ownerId: string) {
  const suffix = randomUUID();
  const company = await prisma.company.create({
    data: { workspaceId, name: `${marker}-${suffix}` }
  });
  const contact = await prisma.contact.create({
    data: {
      workspaceId,
      companyId: company.id,
      firstName: "Phase",
      lastName: "Two",
      source: marker
    }
  });
  const stage = await prisma.pipelineStage.findFirstOrThrow({ where: { key: "NEW" } });
  return prisma.lead.create({
    data: {
      workspaceId,
      companyId: company.id,
      contactId: contact.id,
      ownerId,
      source: marker,
      stageId: stage.id
    }
  });
}

describe("Phase 2 task and activity API", () => {
  beforeEach(async () => {
    await prisma.authSession.deleteMany({ where: { user: { email: { in: [...emails] } } } });
    await prisma.auditEvent.deleteMany({ where: { sourceType: "TASK_API" } });
    await prisma.activity.deleteMany({ where: { lead: { source: marker } } });
    await prisma.lead.deleteMany({ where: { source: marker } });
    await prisma.contact.deleteMany({ where: { source: marker } });
    await prisma.company.deleteMany({ where: { name: { startsWith: marker } } });
    await prisma.user.deleteMany({ where: { email: { in: [...emails] } } });
    await prisma.workspace.deleteMany({ where: { slug: { in: [...slugs] } } });

    const passwordHash = await hashPassword("CorrectHorse123!");
    const [userA, userB] = await Promise.all([
      prisma.user.create({
        data: {
          email: emails[0],
          passwordHash,
          firstName: "Phase",
          lastName: "Admin0",
          role: UserRole.ADMIN,
          status: UserStatus.ACTIVE
        }
      }),
      prisma.user.create({
        data: {
          email: emails[1],
          passwordHash,
          firstName: "Phase",
          lastName: "Admin1",
          role: UserRole.ADMIN,
          status: UserStatus.ACTIVE
        }
      })
    ]);
    const [workspaceA, workspaceB] = await Promise.all([
      prisma.workspace.create({ data: { name: "Phase 2 A", slug: slugs[0] } }),
      prisma.workspace.create({ data: { name: "Phase 2 B", slug: slugs[1] } })
    ]);
    await prisma.workspaceMember.createMany({
      data: [
        { workspaceId: workspaceA.id, userId: userA.id, role: WorkspaceRole.ADMIN },
        { workspaceId: workspaceB.id, userId: userB.id, role: WorkspaceRole.ADMIN }
      ]
    });
  });

  afterAll(async () => {
    await prisma.authSession.deleteMany({ where: { user: { email: { in: [...emails] } } } });
    await prisma.auditEvent.deleteMany({ where: { sourceType: "TASK_API" } });
    await prisma.activity.deleteMany({ where: { lead: { source: marker } } });
    await prisma.lead.deleteMany({ where: { source: marker } });
    await prisma.contact.deleteMany({ where: { source: marker } });
    await prisma.company.deleteMany({ where: { name: { startsWith: marker } } });
    await prisma.user.deleteMany({ where: { email: { in: [...emails] } } });
    await prisma.workspace.deleteMany({ where: { slug: { in: [...slugs] } } });
    await prisma.$disconnect();
  });

  it("creates, audits, projects, completes, and exposes a business timeline task", async () => {
    const workspace = await prisma.workspace.findUniqueOrThrow({ where: { slug: slugs[0] } });
    const user = await prisma.user.findUniqueOrThrow({ where: { email: emails[0] } });
    const lead = await createLead(workspace.id, user.id);
    const token = await login(user.email);

    const createdResponse = await request(app)
      .post("/api/tasks")
      .set("Authorization", `Bearer ${token}`)
      .set("x-workspace-id", workspace.id)
      .send({
        leadId: lead.id,
        title: "Prepare discovery",
        priority: "HIGH",
        dueAt: "2026-10-08T10:00:00.000Z",
        reminderAt: "2026-10-08T09:00:00.000Z",
        isNextAction: true
      })
      .expect(201);
    const created = createdResponse.body as TaskDto;
    expect(created).toMatchObject({
      leadId: lead.id,
      status: "OPEN",
      priority: "HIGH",
      createdByType: "USER",
      isNextAction: true
    });
    expect(await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).toMatchObject({
      nextAction: "Prepare discovery",
      nextActionAt: new Date("2026-10-08T10:00:00.000Z")
    });

    const timeline = await request(app)
      .get(`/api/leads/${lead.id}/activities`)
      .set("Authorization", `Bearer ${token}`)
      .set("x-workspace-id", workspace.id)
      .expect(200);
    const activities = timeline.body as unknown as ActivityDto[];
    expect(activities[0]).toMatchObject({
      entityType: "TASK",
      entityId: created.id,
      actorType: "USER",
      type: "TASK_CREATED",
      visibility: "BUSINESS"
    });
    expect(activities[0]?.correlationId).toEqual(expect.any(String));
    const audit = await prisma.auditEvent.findFirstOrThrow({
      where: { entityType: "Task", entityId: created.id, action: "TASK_CREATED" }
    });
    expect(audit).toMatchObject({
      workspaceId: workspace.id,
      actorType: "USER",
      actorUserId: user.id,
      sourceType: "TASK_API",
      sourceId: created.id
    });
    expect(typeof audit.correlationId).toBe("string");

    await request(app)
      .post(`/api/tasks/${created.id}/complete`)
      .set("Authorization", `Bearer ${token}`)
      .set("x-workspace-id", workspace.id)
      .expect(200);
    expect(await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).toMatchObject({
      nextAction: null,
      nextActionAt: null
    });
  });

  it("bridges direct legacy next-action writes into the projected task", async () => {
    const workspace = await prisma.workspace.findUniqueOrThrow({ where: { slug: slugs[0] } });
    const user = await prisma.user.findUniqueOrThrow({ where: { email: emails[0] } });
    const lead = await createLead(workspace.id, user.id);
    await prisma.lead.update({
      where: { id: lead.id },
      data: {
        nextAction: "Send follow-up email",
        nextActionAt: new Date("2026-10-09T10:00:00.000Z")
      }
    });
    const projected = await prisma.task.findUniqueOrThrow({
      where: { projectionKey: `lead:${lead.id}:next-action` }
    });
    expect(projected).toMatchObject({
      workspaceId: workspace.id,
      title: "Send follow-up email",
      status: "OPEN",
      createdByType: "SYSTEM",
      sourceType: "LEGACY_NEXT_ACTION",
      isNextAction: true
    });
    await prisma.lead.update({
      where: { id: lead.id },
      data: { nextAction: null, nextActionAt: null }
    });
    expect(await prisma.task.findUniqueOrThrow({ where: { id: projected.id } })).toMatchObject({
      status: "COMPLETED",
      completedByType: "SYSTEM"
    });
  });

  it("creates workflow and agent tasks from persisted lead workspace scope", async () => {
    const workspace = await prisma.workspace.findUniqueOrThrow({ where: { slug: slugs[0] } });
    const user = await prisma.user.findUniqueOrThrow({ where: { email: emails[0] } });
    const lead = await createLead(workspace.id, user.id);
    const workflowTask = await createAutomationTask({
      leadId: lead.id,
      title: "Workflow follow-up",
      createdByType: "WORKFLOW",
      sourceType: "FOLLOW_UP_SEQUENCE",
      sourceId: "sequence-1"
    });
    const agentTask = await createAutomationTask({
      leadId: lead.id,
      title: "Agent review",
      createdByType: "AGENT",
      createdByAgentId: "sales-agent-1",
      sourceType: "AI_DECISION",
      sourceId: "decision-1"
    });
    expect(workflowTask).toMatchObject({
      workspaceId: workspace.id,
      createdByType: "WORKFLOW",
      sourceType: "FOLLOW_UP_SEQUENCE"
    });
    expect(agentTask).toMatchObject({
      workspaceId: workspace.id,
      createdByType: "AGENT",
      createdByAgentId: "sales-agent-1"
    });
  });

  it("does not disclose or mutate tasks across workspaces", async () => {
    const [workspaceA, workspaceB] = await Promise.all([
      prisma.workspace.findUniqueOrThrow({ where: { slug: slugs[0] } }),
      prisma.workspace.findUniqueOrThrow({ where: { slug: slugs[1] } })
    ]);
    const [userA, userB] = await Promise.all([
      prisma.user.findUniqueOrThrow({ where: { email: emails[0] } }),
      prisma.user.findUniqueOrThrow({ where: { email: emails[1] } })
    ]);
    const leadA = await createLead(workspaceA.id, userA.id);
    const leadB = await createLead(workspaceB.id, userB.id);
    const tokenA = await login(userA.email);
    const tokenB = await login(userB.email);
    const created = (
      await request(app)
        .post("/api/tasks")
        .set("Authorization", `Bearer ${tokenA}`)
        .set("x-workspace-id", workspaceA.id)
        .send({ leadId: leadA.id, title: "Private workspace task" })
        .expect(201)
    ).body as TaskDto;

    await request(app)
      .get(`/api/tasks/${created.id}`)
      .set("Authorization", `Bearer ${tokenB}`)
      .set("x-workspace-id", workspaceB.id)
      .expect(404);
    await request(app)
      .patch(`/api/tasks/${created.id}`)
      .set("Authorization", `Bearer ${tokenB}`)
      .set("x-workspace-id", workspaceB.id)
      .send({ title: "Cross-workspace write" })
      .expect(404);
    const listed = await request(app)
      .get("/api/tasks")
      .set("Authorization", `Bearer ${tokenB}`)
      .set("x-workspace-id", workspaceB.id)
      .expect(200);
    expect(listed.body).toEqual([]);
    expect(await prisma.task.findUniqueOrThrow({ where: { id: created.id } })).toMatchObject({
      title: "Private workspace task",
      workspaceId: workspaceA.id
    });
    await expect(resolveRealtimeEventScope({ taskId: created.id })).resolves.toEqual({
      workspaceId: workspaceA.id,
      ownerId: userA.id
    });
    await expect(
      resolveRealtimeEventScope({ taskId: created.id, leadId: leadB.id })
    ).resolves.toBeNull();
  });
});
