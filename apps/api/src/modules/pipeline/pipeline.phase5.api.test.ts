import { randomUUID } from "node:crypto";
import request from "supertest";
import { UserRole, UserStatus } from "@prisma/client";
import type { AuthResponse, CompanyDto, ContactDto, DealDto, LeadDto, PaginatedResponse, PipelineDto, PipelineStageDto } from "@shilabs/shared-types";
import { createApp } from "../../app.js";
import { prisma } from "../../shared/prisma.js";
import { hashPassword } from "../auth/auth.service.js";

const app = createApp();
const marker = `phase5-${randomUUID()}`;

async function createWorkspaceIdentity(label: string, role: UserRole = UserRole.ADMIN) {
  const passwordHash = await hashPassword("CorrectHorse123!");
  const user = await prisma.user.create({ data: { email: `${marker}-${label}@example.local`, passwordHash, firstName: label, lastName: "Phase5", role, status: UserStatus.ACTIVE } });
  const workspace = await prisma.workspace.create({ data: { name: `${marker}-${label}`, slug: `${marker}-${label}` } });
  await prisma.workspaceMember.create({ data: { workspaceId: workspace.id, userId: user.id, role: role === UserRole.ADMIN ? "ADMIN" : "SALES_REP", status: "ACTIVE" } });
  const response = await request(app).post("/api/auth/login").send({ email: user.email, password: "CorrectHorse123!" }).expect(200);
  return { user, workspace, token: (response.body as AuthResponse).accessToken };
}

function workspaceRequest(method: "get" | "post" | "patch" | "put", url: string, token: string, workspaceId: string) {
  return request(app)[method](url).set("Authorization", `Bearer ${token}`).set("x-workspace-id", workspaceId);
}

function firstPipeline(pipelines: PipelineDto[]): PipelineDto {
  const pipeline = pipelines[0];
  if (!pipeline) throw new Error("Expected a pipeline");
  return pipeline;
}

function firstStage(pipeline: PipelineDto): PipelineStageDto {
  const stage = pipeline.stages[0];
  if (!stage) throw new Error("Expected a pipeline stage");
  return stage;
}

async function createLead(token: string, workspaceId: string, label: string): Promise<string> {
  const company = await workspaceRequest("post", "/api/companies", token, workspaceId).send({ name: `${marker}-${label}` }).expect(201);
  const companyBody = company.body as unknown as CompanyDto;
  const contact = await workspaceRequest("post", "/api/contacts", token, workspaceId).send({ companyId: companyBody.id, firstName: label, lastName: "Buyer", email: `${marker}-${label}-buyer@example.local` }).expect(201);
  const contactBody = contact.body as unknown as ContactDto;
  const lead = await workspaceRequest("post", "/api/leads", token, workspaceId).send({ companyId: companyBody.id, contactId: contactBody.id, source: "phase5-test" }).expect(201);
  return (lead.body as unknown as LeadDto).id;
}

describe("Phase 5 workspace pipelines and deals", () => {
  beforeAll(async () => {
    const defaultWorkspace = await prisma.workspace.findFirstOrThrow({ orderBy: { createdAt: "asc" } });
    if (!(await prisma.pipelineStage.findFirst({ where: { semanticKey: "NEW" } }))) {
      const maximum = await prisma.pipelineStage.aggregate({ _max: { order: true } });
      await prisma.pipelineStage.create({ data: { workspaceId: defaultWorkspace.id, key: `PHASE5_TEMPLATE_${randomUUID()}`, semanticKey: "NEW", label: "New", order: (maximum._max.order ?? 0) + 1, probability: 10 } });
    }
  });

  afterAll(async () => {
    const workspaces = await prisma.workspace.findMany({ where: { slug: { startsWith: marker } }, select: { id: true } });
    const workspaceIds = workspaces.map((item) => item.id);
    const users = await prisma.user.findMany({ where: { email: { startsWith: marker } }, select: { id: true } });
    const userIds = users.map((item) => item.id);
    const leads = await prisma.lead.findMany({ where: { workspaceId: { in: workspaceIds } }, select: { id: true } });
    const leadIds = leads.map((item) => item.id);
    await prisma.proposal.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    await prisma.task.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    await prisma.activity.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    await prisma.auditEvent.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    await prisma.deal.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    await prisma.lead.deleteMany({ where: { id: { in: leadIds } } });
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

  it("creates distinct workspace stages and blocks cross-workspace pipeline and deal access", async () => {
    const a = await createWorkspaceIdentity("a");
    const b = await createWorkspaceIdentity("b");
    const pipelinesA = (await workspaceRequest("get", "/api/pipeline", a.token, a.workspace.id).expect(200)).body as PipelineDto[];
    const pipelinesB = (await workspaceRequest("get", "/api/pipeline", b.token, b.workspace.id).expect(200)).body as PipelineDto[];
    const stageA = firstStage(firstPipeline(pipelinesA));
    const stageB = firstStage(firstPipeline(pipelinesB));
    expect(stageA.key).toBe("NEW");
    expect(stageB.key).toBe("NEW");
    expect(stageA.id).not.toBe(stageB.id);

    await workspaceRequest("patch", `/api/pipeline/stages/${stageB.id}`, a.token, a.workspace.id).send({ name: "Leaked" }).expect(404);
    const leadA = await createLead(a.token, a.workspace.id, "alpha");
    const dealResponse = await workspaceRequest("post", "/api/deals", a.token, a.workspace.id).send({ leadId: leadA, stageId: stageA.id, value: "12500", currency: "USD" }).expect(201);
    const deal = dealResponse.body as unknown as DealDto;
    await workspaceRequest("get", `/api/deals/${deal.id}`, b.token, b.workspace.id).expect(404);
    const bDeals = await workspaceRequest("get", "/api/deals", b.token, b.workspace.id).expect(200);
    expect((bDeals.body as unknown as PaginatedResponse<DealDto>).items).toHaveLength(0);
  });

  it("supports stage creation, reordering and audited deal moves while restricting reps", async () => {
    const admin = await createWorkspaceIdentity("manager");
    const rep = await createWorkspaceIdentity("rep", UserRole.SALES_REP);
    const pipelines = (await workspaceRequest("get", "/api/pipeline", admin.token, admin.workspace.id).expect(200)).body as PipelineDto[];
    const pipeline = firstPipeline(pipelines);
    const stageResponse = await workspaceRequest("post", `/api/pipeline/${pipeline.id}/stages`, admin.token, admin.workspace.id).send({ name: "Discovery", probability: 35 }).expect(201);
    const discoveryStage = stageResponse.body as unknown as PipelineStageDto;
    const refreshed = (await workspaceRequest("get", "/api/pipeline", admin.token, admin.workspace.id).expect(200)).body as PipelineDto[];
    const refreshedPipeline = firstPipeline(refreshed);
    const ids = refreshedPipeline.stages.map((stage) => stage.id).reverse();
    await workspaceRequest("put", `/api/pipeline/${pipeline.id}/stages/order`, admin.token, admin.workspace.id).send({ stageIds: ids }).expect(200);
    await workspaceRequest("post", "/api/pipeline", rep.token, rep.workspace.id).send({ name: "Forbidden" }).expect(403);

    const leadId = await createLead(admin.token, admin.workspace.id, "move");
    const dealResponse = await workspaceRequest("post", "/api/deals", admin.token, admin.workspace.id).send({ leadId, stageId: firstStage(refreshedPipeline).id }).expect(201);
    const deal = dealResponse.body as unknown as DealDto;
    await workspaceRequest("patch", `/api/deals/${deal.id}`, admin.token, admin.workspace.id).send({ stageId: discoveryStage.id }).expect(200);
    await workspaceRequest("patch", `/api/pipeline/stages/${discoveryStage.id}`, admin.token, admin.workspace.id).send({ status: "ARCHIVED" }).expect(409);
    await workspaceRequest("patch", `/api/deals/${deal.id}`, admin.token, admin.workspace.id).send({ stageId: firstStage(refreshedPipeline).id }).expect(200);
    const archived = await workspaceRequest("patch", `/api/pipeline/stages/${discoveryStage.id}`, admin.token, admin.workspace.id).send({ status: "ARCHIVED" }).expect(200);
    expect((archived.body as unknown as PipelineStageDto).status).toBe("ARCHIVED");
    const reactivated = await workspaceRequest("patch", `/api/pipeline/stages/${discoveryStage.id}`, admin.token, admin.workspace.id).send({ status: "ACTIVE" }).expect(200);
    expect((reactivated.body as unknown as PipelineStageDto).status).toBe("ACTIVE");
    await prisma.auditEvent.findFirstOrThrow({ where: { workspaceId: admin.workspace.id, entityType: "Deal", entityId: deal.id, action: "DEAL_UPDATED", metadata: { path: ["changeType"], equals: "DEAL_STAGE_CHANGED" } } });
    await prisma.activity.findFirstOrThrow({ where: { workspaceId: admin.workspace.id, entityType: "DEAL", entityId: deal.id, title: "Deal stage changed" } });
  });
});
