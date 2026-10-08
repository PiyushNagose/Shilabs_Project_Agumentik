import { randomUUID } from "node:crypto";
import request from "supertest";
import { AgentType, UserRole, UserStatus } from "@prisma/client";
import type {
  AgentComposerPreviewDto,
  AgentComposerValidationDto,
  AgentDashboardDto,
  AgentDetailDto,
  AuthResponse
} from "@shilabs/shared-types";
import { createApp } from "../../app.js";
import { prisma } from "../../shared/prisma.js";
import { hashPassword } from "../auth/auth.service.js";
import { assertAgentCapabilityActive } from "./agent.service.js";

const app = createApp();
const marker = `phase6-${randomUUID()}`;

async function identity(label: string, role: UserRole = UserRole.ADMIN) {
  const user = await prisma.user.create({
    data: {
      email: `${marker}-${label}@example.local`,
      passwordHash: await hashPassword("CorrectHorse123!"),
      firstName: label,
      lastName: "Phase6",
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
  method: "get" | "post" | "patch" | "put",
  path: string,
  token: string,
  workspaceId: string
) {
  const agentRequest = request(app);
  return agentRequest[method](path)
    .set("Authorization", `Bearer ${token}`)
    .set("x-workspace-id", workspaceId);
}

describe("Phase 6 agents", () => {
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
    await prisma.agentExecution.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    await prisma.agent.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    const leads = await prisma.lead.findMany({
      where: { workspaceId: { in: workspaceIds } },
      select: { id: true }
    });
    const leadIds = leads.map(({ id }) => id);
    await prisma.leadScoreRun.deleteMany({ where: { leadId: { in: leadIds } } });
    await prisma.auditEvent.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    await prisma.lead.deleteMany({ where: { id: { in: leadIds } } });
    await prisma.contact.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    await prisma.company.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    await prisma.pipelineStage.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    await prisma.authSession.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.workspaceMember.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    await prisma.workspace.deleteMany({ where: { id: { in: workspaceIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  it("provisions isolated capability agents and prevents cross-workspace reads", async () => {
    const first = await identity("first");
    const second = await identity("second");
    const firstList = (await api("get", "/api/agents", first.token, first.workspace.id).expect(200))
      .body as AgentDashboardDto;
    const secondList = (
      await api("get", "/api/agents", second.token, second.workspace.id).expect(200)
    ).body as AgentDashboardDto;
    expect(firstList.agents).toHaveLength(8);
    expect(firstList.summary.activeAgents).toBe(8);
    expect(secondList.agents).toHaveLength(8);
    expect(firstList.agents[0]?.id).not.toBe(secondList.agents[0]?.id);
    const firstAgent = firstList.agents[0];
    if (!firstAgent) throw new Error("Expected a capability agent");
    await api("get", `/api/agents/${firstAgent.id}`, second.token, second.workspace.id).expect(404);
  });

  it("creates immutable versions and enforces manager lifecycle controls", async () => {
    const admin = await identity("admin");
    const rep = await identity("rep", UserRole.SALES_REP);
    await api("post", "/api/agents", rep.token, rep.workspace.id)
      .send({ name: "Forbidden", description: "No access", type: "OUTREACH" })
      .expect(403);
    const created = (
      await api("post", "/api/agents", admin.token, admin.workspace.id)
        .send({
          name: "Regional Outreach",
          description: "Handles regional outreach",
          type: "OUTREACH",
          definition: { region: "west" }
        })
        .expect(201)
    ).body as AgentDetailDto;
    expect(created.status).toBe("DRAFT");
    expect(created.versions).toHaveLength(1);
    const originalVersionId = created.currentVersionId;
    if (!originalVersionId) throw new Error("Expected a current version");
    const edited = (
      await api("patch", `/api/agents/${created.id}`, admin.token, admin.workspace.id)
        .send({
          description: "Handles governed regional outreach",
          definition: { region: "west", governed: true }
        })
        .expect(200)
    ).body as AgentDetailDto;
    expect(edited.versions).toHaveLength(2);
    expect(edited.currentVersionId).not.toBe(originalVersionId);
    expect(
      await prisma.agentVersion.findUnique({ where: { id: originalVersionId } })
    ).not.toBeNull();
    const active = (
      await api("patch", `/api/agents/${created.id}/status`, admin.token, admin.workspace.id)
        .send({ status: "ACTIVE" })
        .expect(200)
    ).body as AgentDetailDto;
    expect(active.currentVersion?.publishedAt).not.toBeNull();
    await api("patch", `/api/agents/${created.id}/status`, admin.token, admin.workspace.id)
      .send({ status: "PAUSED" })
      .expect(200);
    await api("patch", `/api/agents/${created.id}/status`, admin.token, admin.workspace.id)
      .send({ status: "ACTIVE" })
      .expect(200);
    await api("patch", `/api/agents/${created.id}/status`, admin.token, admin.workspace.id)
      .send({ status: "ARCHIVED" })
      .expect(200);
    await api("patch", `/api/agents/${created.id}/status`, admin.token, admin.workspace.id)
      .send({ status: "ACTIVE" })
      .expect(409);
    expect(
      await prisma.auditEvent.count({
        where: { workspaceId: admin.workspace.id, entityType: "Agent", entityId: created.id }
      })
    ).toBeGreaterThanOrEqual(5);
  });

  it("blocks capability execution when every mapped agent is paused", async () => {
    const admin = await identity("pause");
    const dashboard = (await api("get", "/api/agents", admin.token, admin.workspace.id).expect(200))
      .body as AgentDashboardDto;
    const proposal = dashboard.agents.find((agent) => agent.type === "PROPOSAL");
    if (!proposal) throw new Error("Expected proposal agent");
    await api("patch", `/api/agents/${proposal.id}/status`, admin.token, admin.workspace.id)
      .send({ status: "PAUSED" })
      .expect(200);
    await expect(
      assertAgentCapabilityActive(admin.workspace.id, AgentType.PROPOSAL)
    ).rejects.toMatchObject({ statusCode: 409, code: "CONFLICT" });
    await api("patch", `/api/agents/${proposal.id}/status`, admin.token, admin.workspace.id)
      .send({ status: "ACTIVE" })
      .expect(200);
    await expect(
      assertAgentCapabilityActive(admin.workspace.id, AgentType.PROPOSAL)
    ).resolves.toBeUndefined();
  });

  it("saves isolated drafts, validates graphs, previews safely, and publishes immutable versions", async () => {
    const admin = await identity("composer-admin");
    const other = await identity("composer-other");
    const rep = await identity("composer-rep", UserRole.SALES_REP);
    await prisma.workspaceMember.create({
      data: {
        workspaceId: admin.workspace.id,
        userId: rep.user.id,
        role: "SALES_REP",
        status: "ACTIVE"
      }
    });
    const dashboard = (await api("get", "/api/agents", admin.token, admin.workspace.id).expect(200))
      .body as AgentDashboardDto;
    const agent = dashboard.agents.find((item) => item.type === "OUTREACH");
    if (!agent?.currentVersionId) throw new Error("Expected a published outreach agent");
    const publishedVersionId = agent.currentVersionId;
    const validDefinition = {
      schemaVersion: 1,
      kind: "AGENT_COMPOSER",
      nodes: [
        {
          id: "trigger",
          type: "TRIGGER",
          label: "Lead updated",
          position: { x: 20, y: 20 },
          config: { event: "LEAD_UPDATED" }
        },
        {
          id: "decision",
          type: "AI_DECISION",
          label: "Choose path",
          position: { x: 20, y: 140 },
          config: { instruction: "Choose a safe path" }
        },
        {
          id: "action",
          type: "TOOL_CRM_ACTION",
          label: "Start outreach",
          position: { x: 20, y: 260 },
          config: { capability: "outreach" }
        },
        {
          id: "handoff",
          type: "HUMAN_HANDOFF",
          label: "Ask manager",
          position: { x: 260, y: 260 },
          config: { reason: "Confidence is low" }
        },
        {
          id: "end",
          type: "END",
          label: "Complete",
          position: { x: 20, y: 380 },
          config: { outcome: "Recorded" }
        }
      ],
      edges: [
        { id: "e1", source: "trigger", target: "decision", branch: null },
        { id: "e2", source: "decision", target: "action", branch: "approved" },
        { id: "e3", source: "decision", target: "handoff", branch: "review" },
        { id: "e4", source: "action", target: "end", branch: null },
        { id: "e5", source: "handoff", target: "end", branch: null }
      ]
    };

    await api("put", `/api/agents/${agent.id}/composer`, rep.token, admin.workspace.id)
      .send({ definition: validDefinition })
      .expect(403);
    await api("get", `/api/agents/${agent.id}`, other.token, other.workspace.id).expect(404);

    const drafted = (
      await api("put", `/api/agents/${agent.id}/composer`, admin.token, admin.workspace.id)
        .send({ definition: validDefinition })
        .expect(200)
    ).body as AgentDetailDto;
    expect(drafted.currentVersionId).toBe(publishedVersionId);
    expect(drafted.draftVersionId).not.toBeNull();
    expect(drafted.draftVersion?.publishedAt).toBeNull();
    expect(drafted.currentVersion?.publishedAt).not.toBeNull();

    await api(
      "post",
      `/api/agents/${agent.id}/composer/validate`,
      admin.token,
      admin.workspace.id
    ).expect(200, { valid: true, issues: [] });
    const executionCountBefore = await prisma.agentExecution.count({
      where: { workspaceId: admin.workspace.id, agentId: agent.id }
    });
    const preview = await api(
      "post",
      `/api/agents/${agent.id}/composer/preview`,
      admin.token,
      admin.workspace.id
    )
      .send({ definition: validDefinition })
      .expect(200);
    expect(preview.body).toMatchObject({ safe: true, mode: "SANDBOX" });
    const previewBody = preview.body as AgentComposerPreviewDto;
    expect(previewBody.blockedActions).toContain("outreach");
    expect(
      await prisma.agentExecution.count({
        where: { workspaceId: admin.workspace.id, agentId: agent.id }
      })
    ).toBe(executionCountBefore);

    const invalidDefinition = {
      ...validDefinition,
      nodes: [
        ...validDefinition.nodes,
        {
          id: "orphan",
          type: "MESSAGE",
          label: "Disconnected",
          position: { x: 500, y: 500 },
          config: { message: "Unused" }
        }
      ]
    };
    await api("put", `/api/agents/${agent.id}/composer`, admin.token, admin.workspace.id)
      .send({ definition: invalidDefinition })
      .expect(200);
    const invalid = await api(
      "post",
      `/api/agents/${agent.id}/composer/validate`,
      admin.token,
      admin.workspace.id
    ).expect(200);
    const invalidBody = invalid.body as AgentComposerValidationDto;
    expect(invalidBody.valid).toBe(false);
    expect(invalidBody.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "DISCONNECTED_NODE", nodeId: "orphan" })
      ])
    );
    await api(
      "post",
      `/api/agents/${agent.id}/composer/publish`,
      admin.token,
      admin.workspace.id
    ).expect(422);

    const redrafted = (
      await api("put", `/api/agents/${agent.id}/composer`, admin.token, admin.workspace.id)
        .send({ definition: validDefinition })
        .expect(200)
    ).body as AgentDetailDto;
    const draftVersionId = redrafted.draftVersionId;
    const published = (
      await api(
        "post",
        `/api/agents/${agent.id}/composer/publish`,
        admin.token,
        admin.workspace.id
      ).expect(200)
    ).body as AgentDetailDto;
    expect(published.currentVersionId).toBe(draftVersionId);
    expect(published.draftVersionId).toBeNull();
    expect(published.currentVersion?.publishedAt).not.toBeNull();
    expect(
      await prisma.agentVersion.findUnique({ where: { id: publishedVersionId } })
    ).toMatchObject({ id: publishedVersionId });
    expect(
      await prisma.auditEvent.count({
        where: {
          workspaceId: admin.workspace.id,
          entityId: agent.id,
          action: { in: ["AGENT_COMPOSER_DRAFT_SAVED", "AGENT_COMPOSER_PUBLISHED"] }
        }
      })
    ).toBeGreaterThanOrEqual(3);
  });

  it("projects existing capability runs into business-visible execution summaries", async () => {
    const admin = await identity("execution");
    const company = await prisma.company.create({
      data: { workspaceId: admin.workspace.id, name: `${marker}-company` }
    });
    const contact = await prisma.contact.create({
      data: {
        workspaceId: admin.workspace.id,
        companyId: company.id,
        firstName: "Test",
        lastName: "Buyer",
        email: `${marker}-buyer@example.local`,
        normalizedEmail: `${marker}-buyer@example.local`
      }
    });
    const stage = await prisma.pipelineStage.create({
      data: {
        workspaceId: admin.workspace.id,
        key: `${marker}-new`,
        label: "New",
        order: 9000,
        probability: 10
      }
    });
    const lead = await prisma.lead.create({
      data: {
        workspaceId: admin.workspace.id,
        companyId: company.id,
        contactId: contact.id,
        stageId: stage.id,
        source: "phase6-test"
      }
    });
    const run = await prisma.leadScoreRun.create({
      data: {
        leadId: lead.id,
        source: "RULE_ENGINE",
        status: "COMPLETED",
        score: 80,
        temperature: "HOT",
        reason: "Strong qualification evidence"
      }
    });
    const dashboard = (await api("get", "/api/agents", admin.token, admin.workspace.id).expect(200))
      .body as AgentDashboardDto;
    const qualification = dashboard.agents.find((item) => item.type === "QUALIFICATION");
    if (!qualification) throw new Error("Expected qualification agent");
    expect(qualification.executionCount).toBe(1);
    const detail = (
      await api("get", `/api/agents/${qualification.id}`, admin.token, admin.workspace.id).expect(
        200
      )
    ).body as AgentDetailDto;
    expect(detail.executions[0]).toMatchObject({
      sourceEntityId: run.id,
      status: "SUCCEEDED",
      summary: "Strong qualification evidence"
    });
    expect(detail.executions[0]?.evaluation).toEqual({ outcome: "PASSED" });
  });
});
