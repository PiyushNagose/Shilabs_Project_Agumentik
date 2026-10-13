import { randomUUID } from "node:crypto";
import request from "supertest";
import { UserRole, UserStatus } from "@prisma/client";
import type {
  AiCommandCenterDto,
  AuthResponse,
  LeadDocumentDto,
  LeadIntelligenceDecisionDto,
  LeadIntelligenceDto
} from "@shilabs/shared-types";
import { createApp } from "../../app.js";
import { prisma } from "../../shared/prisma.js";
import { hashPassword } from "../auth/auth.service.js";

const app = createApp();
const marker = `phase10-${randomUUID()}`;
const stageKey = `PHASE10_${randomUUID().replaceAll("-", "_")}`;

async function identity(label: string, role: UserRole = UserRole.ADMIN) {
  const user = await prisma.user.create({
    data: {
      email: `${marker}-${label}@example.local`,
      passwordHash: await hashPassword("CorrectHorse123!"),
      firstName: label,
      lastName: "Phase10",
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
      role:
        role === UserRole.SALES_REP
          ? "SALES_REP"
          : role === UserRole.SALES_MANAGER
            ? "SALES_MANAGER"
            : "ADMIN",
      status: "ACTIVE"
    }
  });
  const login = await request(app)
    .post("/api/auth/login")
    .send({ email: user.email, password: "CorrectHorse123!" })
    .expect(200);
  return { user, workspace, token: (login.body as AuthResponse).accessToken };
}

async function leadFor(identityRecord: Awaited<ReturnType<typeof identity>>, label: string) {
  const stage = await prisma.pipelineStage.upsert({
    where: { key: stageKey },
    update: {},
    create: { key: stageKey, label: "Phase 10 New", order: 9700, probability: 20 }
  });
  const company = await prisma.company.create({
    data: {
      workspaceId: identityRecord.workspace.id,
      name: `${marker}-${label}-company`,
      industry: "Technology"
    }
  });
  const contact = await prisma.contact.create({
    data: {
      workspaceId: identityRecord.workspace.id,
      companyId: company.id,
      firstName: label,
      lastName: "Prospect",
      email: `${marker}-${label}@customer.local`,
      source: marker
    }
  });
  return prisma.lead.create({
    data: {
      workspaceId: identityRecord.workspace.id,
      companyId: company.id,
      contactId: contact.id,
      ownerId: identityRecord.user.id,
      source: marker,
      stageId: stage.id,
      requirement: "Improve organic acquisition",
      serviceInterest: "SEO audit",
      score: 82,
      temperature: "HOT",
      automationOwnershipState: "AI_ACTIVE",
      estimatedValue: "12000",
      currency: "USD"
    }
  });
}

function api(
  method: "get" | "post" | "patch" | "delete",
  path: string,
  token: string,
  workspaceId: string
) {
  const client = request(app);
  return client[method](path)
    .set("Authorization", `Bearer ${token}`)
    .set("x-workspace-id", workspaceId);
}

describe("Phase 10 lead intelligence API", () => {
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
    await prisma.leadIntelligenceDecision.deleteMany({
      where: { workspaceId: { in: workspaceIds } }
    });
    await prisma.leadDocument.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    await prisma.leadIntelligence.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    await prisma.message.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    await prisma.conversation.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    await prisma.task.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    await prisma.lead.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    await prisma.contact.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    await prisma.company.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    await prisma.authSession.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.workspaceMember.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    await prisma.workspace.deleteMany({ where: { id: { in: workspaceIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.pipelineStage.deleteMany({ where: { key: stageKey } });
    await prisma.$disconnect();
  }, 45000);

  it("indexes exact document evidence and never invents document findings", async () => {
    const admin = await identity("grounding");
    const lead = await leadFor(admin, "Grounded");
    const document = (
      await api(
        "post",
        `/api/lead-intelligence/leads/${lead.id}/documents`,
        admin.token,
        admin.workspace.id
      )
        .send({
          title: "Organic visibility audit",
          kind: "AUDIT",
          sourceType: "UPLOAD",
          mimeType: "text/plain",
          content:
            "Organic traffic declined 32% over six months. Commercial keyword visibility is the primary concern."
        })
        .expect(201)
    ).body as LeadDocumentDto;
    expect(document.status).toBe("INDEXED");
    expect(document.chunkCount).toBe(1);

    const intelligence = (
      await api(
        "get",
        `/api/lead-intelligence/leads/${lead.id}`,
        admin.token,
        admin.workspace.id
      ).expect(200)
    ).body as LeadIntelligenceDto;
    expect(intelligence.summary).toContain("Improve organic acquisition");
    expect(
      intelligence.evidence.some(
        (item) => item.sourceId.startsWith("document-chunk:") && item.quote.includes("declined 32%")
      )
    ).toBe(true);
    expect(intelligence.evidence.every((item) => item.quote.length > 0)).toBe(true);
  });

  it("escalates high-risk client language and blocks cross-workspace reads", async () => {
    const manager = await identity("manager", UserRole.SALES_MANAGER);
    const other = await identity("other");
    const lead = await leadFor(manager, "Risk");
    const conversation = await prisma.conversation.create({
      data: {
        workspaceId: manager.workspace.id,
        leadId: lead.id,
        channel: "EMAIL",
        mode: "AUTO"
      }
    });
    await prisma.message.create({
      data: {
        workspaceId: manager.workspace.id,
        conversationId: conversation.id,
        direction: "INBOUND",
        senderType: "PROSPECT",
        body: "Your pricing is too high. I need a discount and legal contract changes."
      }
    });

    const decision = (
      await api(
        "post",
        `/api/lead-intelligence/leads/${lead.id}/decisions`,
        manager.token,
        manager.workspace.id
      )
        .send({})
        .expect(201)
    ).body as LeadIntelligenceDecisionDto;
    expect(decision.decision).toBe("ESCALATE");
    expect(decision.guardrailCode).toBe("HIGH_RISK_CLIENT_CONTEXT");
    expect(decision.evidence[0]?.quote).toContain("pricing is too high");
    await expect(
      prisma.lead
        .findUniqueOrThrow({ where: { id: lead.id } })
        .then((item) => item.automationOwnershipState)
    ).resolves.toBe("HUMAN_REQUIRED");
    await api(
      "get",
      `/api/lead-intelligence/leads/${lead.id}`,
      other.token,
      other.workspace.id
    ).expect(404);
  });

  it("enforces manager controls and stops pending AI ownership when paused", async () => {
    const manager = await identity("controls", UserRole.SALES_MANAGER);
    const rep = await identity("rep", UserRole.SALES_REP);
    const lead = await leadFor(manager, "Controls");
    await api(
      "patch",
      `/api/lead-intelligence/leads/${lead.id}/controls`,
      rep.token,
      rep.workspace.id
    )
      .send({ aiControlStatus: "PAUSED" })
      .expect(403);
    const updated = (
      await api(
        "patch",
        `/api/lead-intelligence/leads/${lead.id}/controls`,
        manager.token,
        manager.workspace.id
      )
        .send({ aiControlStatus: "PAUSED", followUpMode: "HIGH_VALUE", preferredChannel: "MIXED" })
        .expect(200)
    ).body as LeadIntelligenceDto;
    expect(updated.aiControlStatus).toBe("PAUSED");
    expect(updated.followUpMode).toBe("HIGH_VALUE");
    await expect(
      prisma.lead
        .findUniqueOrThrow({ where: { id: lead.id } })
        .then((item) => item.automationOwnershipState)
    ).resolves.toBe("AI_STOPPED");
    expect(
      await prisma.auditEvent.count({
        where: { workspaceId: manager.workspace.id, action: "LEAD_AI_CONTROLS_UPDATED" }
      })
    ).toBe(1);
  });

  it("returns real manager command-center metrics and rejects sales reps", async () => {
    const admin = await identity("command");
    const rep = await identity("command-rep", UserRole.SALES_REP);
    await leadFor(admin, "Command");
    const dashboard = (
      await api(
        "get",
        "/api/lead-intelligence/command-center",
        admin.token,
        admin.workspace.id
      ).expect(200)
    ).body as AiCommandCenterDto;
    expect(dashboard.metrics.activeLeads).toBe(1);
    expect(dashboard.metrics.aiActive).toBe(1);
    expect(dashboard.metrics.pipelineValue).toBe("12000.00");
    expect(dashboard.humanKpis).toMatchObject({
      leadsHandled: 0,
      opportunities: 0,
      conversionRate: 0,
      revenue: "0.00"
    });
    expect(dashboard.aiKpis).toMatchObject({
      followUpsSent: 0,
      repliesGenerated: 0,
      handovers: 0
    });
    expect(dashboard.recommendations[0]?.companyName).toContain("Command");
    await api("get", "/api/lead-intelligence/command-center", rep.token, rep.workspace.id).expect(
      403
    );
  });

  it("keeps command-center recommendations bounded for a large workspace", async () => {
    const admin = await identity("command-volume");
    const seedLead = await leadFor(admin, "Command Volume");
    await prisma.lead.createMany({
      data: Array.from({ length: 750 }, (_, index) => ({
        id: `${marker}-volume-${String(index)}`,
        workspaceId: admin.workspace.id,
        companyId: seedLead.companyId,
        contactId: seedLead.contactId,
        ownerId: admin.user.id,
        source: marker,
        stageId: seedLead.stageId,
        score: index % 101,
        temperature: index % 5 === 0 ? "HOT" : "NURTURE",
        automationOwnershipState: "AI_ACTIVE",
        estimatedValue: "100",
        currency: "USD"
      }))
    });

    const startedAt = performance.now();
    const dashboard = (
      await api(
        "get",
        "/api/lead-intelligence/command-center",
        admin.token,
        admin.workspace.id
      ).expect(200)
    ).body as AiCommandCenterDto;

    expect(dashboard.metrics.activeLeads).toBe(751);
    expect(dashboard.recommendations).toHaveLength(50);
    expect(dashboard.recommendations[0]?.score).toBe(100);
    expect(performance.now() - startedAt).toBeLessThan(5000);
  });
});
