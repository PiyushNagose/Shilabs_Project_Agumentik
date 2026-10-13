import { randomUUID } from "node:crypto";
import request from "supertest";
import { UserRole, UserStatus } from "@prisma/client";
import type {
  AuthResponse,
  WorkflowDetailDto,
  WorkflowExecutionDto,
  WorkflowPreviewDto,
  WorkflowValidationDto
} from "@shilabs/shared-types";
import { createApp } from "../../app.js";
import { prisma } from "../../shared/prisma.js";
import { hashPassword } from "../auth/auth.service.js";

const app = createApp();
const marker = `phase8-${randomUUID()}`;
async function identity(label: string, role: UserRole = UserRole.ADMIN) {
  const user = await prisma.user.create({
    data: {
      email: `${marker}-${label}@example.local`,
      passwordHash: await hashPassword("CorrectHorse123!"),
      firstName: label,
      lastName: "Phase8",
      role,
      status: UserStatus.ACTIVE
    }
  });
  const workspace = await prisma.workspace.create({
    data: { name: `${marker}-${label}`, slug: `${marker}-${label}` }
  });
  await prisma.workspaceMember.create({
    data: {
      workspaceId: workspace.id,
      userId: user.id,
      role: role === UserRole.ADMIN ? "ADMIN" : "SALES_REP",
      status: "ACTIVE"
    }
  });
  const login = await request(app)
    .post("/api/auth/login")
    .send({ email: user.email, password: "CorrectHorse123!" })
    .expect(200);
  return { user, workspace, token: (login.body as AuthResponse).accessToken };
}
function api(
  method: "get" | "post" | "put" | "patch",
  path: string,
  token: string,
  workspaceId: string
) {
  const client = request(app);
  return client[method](path)
    .set("Authorization", `Bearer ${token}`)
    .set("x-workspace-id", workspaceId);
}
async function leadFixture(workspaceId: string, ownerId: string) {
  const pipeline = await prisma.pipeline.create({
    data: { workspaceId, name: `${marker}-${randomUUID()}`, isDefault: true }
  });
  const previous = await prisma.pipelineStage.findFirst({ orderBy: { order: "desc" } });
  const stage = await prisma.pipelineStage.create({
    data: {
      workspaceId,
      pipelineId: pipeline.id,
      key: `${marker}-${randomUUID()}`,
      semanticKey: "NEW",
      label: "New",
      order: (previous?.order ?? 0) + 1,
      position: 0,
      probability: 10
    }
  });
  const company = await prisma.company.create({
    data: { workspaceId, name: `${marker}-company-${randomUUID()}`, location: "India" }
  });
  const contact = await prisma.contact.create({
    data: {
      workspaceId,
      companyId: company.id,
      firstName: "Phase",
      lastName: "Eight",
      source: marker
    }
  });
  return prisma.lead.create({
    data: {
      workspaceId,
      companyId: company.id,
      contactId: contact.id,
      ownerId,
      stageId: stage.id,
      source: "website",
      serviceInterest: "SEO",
      automationOwnershipState: "AI_ACTIVE"
    }
  });
}
const validDefinition = {
  schemaVersion: 1,
  kind: "WORKFLOW",
  nodes: [
    {
      id: "trigger",
      type: "TRIGGER",
      label: "Lead updated",
      position: { x: 10, y: 10 },
      config: { event: "LEAD_UPDATED" }
    },
    {
      id: "task",
      type: "TASK",
      label: "Follow up",
      position: { x: 10, y: 120 },
      config: { title: "Follow up with lead", dueMinutes: 60 }
    },
    {
      id: "end",
      type: "END",
      label: "Done",
      position: { x: 10, y: 230 },
      config: { outcome: "COMPLETED" }
    }
  ],
  edges: [
    { id: "e1", source: "trigger", target: "task", branch: null },
    { id: "e2", source: "task", target: "end", branch: null }
  ]
} as const;

describe("Phase 8 workflow API", () => {
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
    await prisma.domainEventOutbox.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    await prisma.auditEvent.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    await prisma.activity.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    await prisma.task.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    await prisma.workflow.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    const leads = await prisma.lead.findMany({
      where: { workspaceId: { in: workspaceIds } },
      select: { id: true }
    });
    await prisma.lead.deleteMany({ where: { id: { in: leads.map(({ id }) => id) } } });
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
  it("enforces RBAC and workspace isolation", async () => {
    const admin = await identity("admin");
    const other = await identity("other");
    const rep = await identity("rep", UserRole.SALES_REP);
    const created = (
      await api("post", "/api/workflows", admin.token, admin.workspace.id)
        .send({ name: "Lead follow-up", description: "Durable lead follow-up" })
        .expect(201)
    ).body as WorkflowDetailDto;
    await api("get", `/api/workflows/${created.id}`, other.token, other.workspace.id).expect(404);
    await prisma.workspaceMember.create({
      data: {
        workspaceId: admin.workspace.id,
        userId: rep.user.id,
        role: "SALES_REP",
        status: "ACTIVE"
      }
    });
    await api("put", `/api/workflows/${created.id}/draft`, rep.token, admin.workspace.id)
      .send({ definition: validDefinition })
      .expect(403);
    await api("get", `/api/workflows/${created.id}`, rep.token, admin.workspace.id).expect(200);
  });
  it("validates, previews safely, publishes immutable versions, and queues idempotent execution", async () => {
    const admin = await identity("runtime");
    const lead = await leadFixture(admin.workspace.id, admin.user.id);
    const workflow = (
      await api("post", "/api/workflows", admin.token, admin.workspace.id)
        .send({ name: "Priority flow", description: "Follow-up task flow" })
        .expect(201)
    ).body as WorkflowDetailDto;
    const original = workflow.draftVersionId;
    await api("put", `/api/workflows/${workflow.id}/draft`, admin.token, admin.workspace.id)
      .send({
        definition: validDefinition,
        policyConfig: {
          service: "SEO",
          source: "website",
          country: "India",
          cadenceMinutes: [60, 1440]
        }
      })
      .expect(200);
    const validation = (
      await api(
        "post",
        `/api/workflows/${workflow.id}/validate`,
        admin.token,
        admin.workspace.id
      ).expect(200)
    ).body as WorkflowValidationDto;
    expect(validation.valid).toBe(true);
    const preview = (
      await api("post", `/api/workflows/${workflow.id}/preview`, admin.token, admin.workspace.id)
        .send({ definition: validDefinition })
        .expect(200)
    ).body as WorkflowPreviewDto;
    expect(preview.safe).toBe(true);
    expect(preview.blockedActions).toContain("Follow up");
    const published = (
      await api(
        "post",
        `/api/workflows/${workflow.id}/publish`,
        admin.token,
        admin.workspace.id
      ).expect(200)
    ).body as WorkflowDetailDto;
    expect(published.status).toBe("PUBLISHED");
    expect(published.currentVersionId).not.toBe(original);
    expect(published.currentVersion?.publishedAt).not.toBeNull();
    const body = { leadId: lead.id, source: "MANUAL", idempotencyKey: `${marker}-execution` };
    const first = (
      await api("post", `/api/workflows/${workflow.id}/execute`, admin.token, admin.workspace.id)
        .send(body)
        .expect(202)
    ).body as WorkflowExecutionDto;
    const second = (
      await api("post", `/api/workflows/${workflow.id}/execute`, admin.token, admin.workspace.id)
        .send(body)
        .expect(202)
    ).body as WorkflowExecutionDto;
    expect(second.id).toBe(first.id);
    await expect(
      prisma.domainEventOutbox.findFirstOrThrow({ where: { aggregateId: first.id } })
    ).resolves.toMatchObject({
      workspaceId: admin.workspace.id,
      eventType: "WORKFLOW_EXECUTION_REQUESTED"
    });
  });
  it("blocks execution when centralized ownership is not AI active", async () => {
    const admin = await identity("blocked");
    const lead = await leadFixture(admin.workspace.id, admin.user.id);
    await prisma.lead.update({
      where: { id: lead.id },
      data: { automationOwnershipState: "HUMAN_REQUIRED" }
    });
    const workflow = (
      await api("post", "/api/workflows", admin.token, admin.workspace.id)
        .send({
          name: "Blocked flow",
          description: "Must respect ownership",
          definition: validDefinition
        })
        .expect(201)
    ).body as WorkflowDetailDto;
    await api(
      "post",
      `/api/workflows/${workflow.id}/publish`,
      admin.token,
      admin.workspace.id
    ).expect(200);
    await api("post", `/api/workflows/${workflow.id}/execute`, admin.token, admin.workspace.id)
      .send({ leadId: lead.id, source: "MANUAL" })
      .expect(409);
  });
});
