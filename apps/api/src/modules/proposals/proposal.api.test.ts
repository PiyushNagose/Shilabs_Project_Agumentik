import { randomUUID } from "node:crypto";
import request from "supertest";
import { UserRole, UserStatus } from "@prisma/client";
import type { AuthResponse, ProposalDto } from "@shilabs/shared-types";
import { createApp } from "../../app.js";
import { prisma } from "../../shared/prisma.js";
import { hashPassword } from "../auth/auth.service.js";

const app = createApp();
const marker = `proposal-scope-${randomUUID()}`;
const password = "CorrectHorse123!";

async function createIdentity(label: string, workspaceId: string) {
  const user = await prisma.user.create({
    data: {
      email: `${marker}-${label}@example.local`,
      passwordHash: await hashPassword(password),
      firstName: label,
      lastName: "Proposal",
      role: UserRole.ADMIN,
      status: UserStatus.ACTIVE
    }
  });
  await prisma.workspaceMember.create({
    data: { workspaceId, userId: user.id, role: "ADMIN", status: "ACTIVE" }
  });
  const login = await request(app)
    .post("/api/auth/login")
    .send({ email: user.email, password })
    .expect(200);
  return { user, token: (login.body as AuthResponse).accessToken };
}

function api(method: "get" | "post" | "patch", path: string, token: string, workspaceId: string) {
  const agent = request(app);
  return agent[method](path)
    .set("Authorization", `Bearer ${token}`)
    .set("x-workspace-id", workspaceId);
}

async function createCrmRecord(workspaceId: string, ownerId: string, label: string) {
  const stage = await prisma.pipelineStage.create({
    data: {
      workspaceId,
      key: `${marker}-${label}`,
      label: "Proposal",
      order: 5000,
      probability: 70
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
      lastName: "Buyer",
      email: `${marker}-${label}-buyer@example.local`,
      normalizedEmail: `${marker}-${label}-buyer@example.local`
    }
  });
  const lead = await prisma.lead.create({
    data: {
      workspaceId,
      companyId: company.id,
      contactId: contact.id,
      ownerId,
      stageId: stage.id,
      source: marker
    }
  });
  const deal = await prisma.deal.create({
    data: {
      workspaceId,
      leadId: lead.id,
      stageId: stage.id,
      ownerId,
      probability: 70,
      status: "OPEN"
    }
  });
  return { lead, deal };
}

describe("proposal tenant and object authorization", () => {
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
    const proposals = await prisma.proposal.findMany({
      where: { workspaceId: { in: workspaceIds } },
      select: { id: true }
    });
    const proposalIds = proposals.map(({ id }) => id);
    await prisma.proposal.updateMany({
      where: { id: { in: proposalIds } },
      data: { currentVersionId: null, approvedVersionId: null }
    });
    await prisma.proposalStatusChange.deleteMany({ where: { proposalId: { in: proposalIds } } });
    await prisma.proposalVersion.deleteMany({ where: { proposalId: { in: proposalIds } } });
    await prisma.proposal.deleteMany({ where: { id: { in: proposalIds } } });
    await prisma.activity.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    await prisma.auditEvent.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    await prisma.deal.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    await prisma.lead.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    await prisma.contact.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    await prisma.company.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    await prisma.pipelineStage.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    await prisma.authSession.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.workspaceMember.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    await prisma.workspace.deleteMany({ where: { id: { in: workspaceIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  it("scopes list, get, create, update, and send to the selected workspace", async () => {
    const workspaceA = await prisma.workspace.create({
      data: { name: `${marker} A`, slug: `${marker}-a` }
    });
    const workspaceB = await prisma.workspace.create({
      data: { name: `${marker} B`, slug: `${marker}-b` }
    });
    const actorA = await createIdentity("actor-a", workspaceA.id);
    const actorB = await createIdentity("actor-b", workspaceB.id);
    const recordA = await createCrmRecord(workspaceA.id, actorA.user.id, "a");
    const recordB = await createCrmRecord(workspaceB.id, actorB.user.id, "b");

    const proposal = (
      await api("post", "/api/proposals", actorA.token, workspaceA.id)
        .send({
          leadId: recordA.lead.id,
          dealId: recordA.deal.id,
          title: "Workspace A proposal",
          content: "Private workspace A proposal"
        })
        .expect(201)
    ).body as ProposalDto;

    const foreignList = (
      await api("get", "/api/proposals", actorB.token, workspaceB.id).expect(200)
    ).body as ProposalDto[];
    expect(foreignList.some((item) => item.id === proposal.id)).toBe(false);

    await api("get", `/api/proposals/${proposal.id}`, actorB.token, workspaceB.id).expect(404);
    await api("patch", `/api/proposals/${proposal.id}/draft`, actorB.token, workspaceB.id)
      .send({ content: "Cross-workspace edit" })
      .expect(404);
    await api("post", `/api/proposals/${proposal.id}/send`, actorB.token, workspaceB.id)
      .send({})
      .expect(404);

    await api("post", "/api/proposals", actorB.token, workspaceB.id)
      .send({
        leadId: recordA.lead.id,
        title: "Cross-workspace proposal",
        content: "Must not be created"
      })
      .expect(403);
    await api("post", "/api/proposals", actorA.token, workspaceA.id)
      .send({
        leadId: recordA.lead.id,
        dealId: recordB.deal.id,
        title: "Foreign deal proposal",
        content: "Must not be created"
      })
      .expect(404);

    await api("get", `/api/proposals/${proposal.id}`, actorA.token, workspaceA.id).expect(200);
  }, 60000);
});
