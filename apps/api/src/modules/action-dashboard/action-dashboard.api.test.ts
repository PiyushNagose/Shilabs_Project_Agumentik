import request from "supertest";
import { UserRole, UserStatus } from "@prisma/client";
import type { AuthResponse, SalesActionDashboardDto } from "@shilabs/shared-types";
import { createApp } from "../../app.js";
import { prisma } from "../../shared/prisma.js";
import { hashPassword } from "../auth/auth.service.js";

const app = createApp();
const password = "CorrectHorse123!";
const adminEmail = "r19-dashboard-admin@example.local";
const repEmail = "r19-dashboard-rep@example.local";
const otherRepEmail = "r19-dashboard-other@example.local";
const companyPrefix = "R19 Dashboard Company";

async function cleanup(): Promise<void> {
  await prisma.authSession.deleteMany({
    where: { user: { email: { in: [adminEmail, repEmail, otherRepEmail] } } }
  });
  await prisma.domainEventOutbox.deleteMany({
    where: { idempotencyKey: { startsWith: "r19-dashboard:" } }
  });
  await prisma.internalNotification.deleteMany({
    where: { idempotencyKey: { startsWith: "r19-dashboard:" } }
  });
  await prisma.humanTakeover.deleteMany({
    where: { lead: { company: { name: { startsWith: companyPrefix } } } }
  });
  await prisma.followUpAttempt.deleteMany({
    where: { lead: { company: { name: { startsWith: companyPrefix } } } }
  });
  await prisma.followUpSequence.deleteMany({
    where: { lead: { company: { name: { startsWith: companyPrefix } } } }
  });
  await prisma.proposalStatusChange.deleteMany({
    where: { proposal: { lead: { company: { name: { startsWith: companyPrefix } } } } }
  });
  await prisma.proposalVersion.deleteMany({
    where: { proposal: { lead: { company: { name: { startsWith: companyPrefix } } } } }
  });
  await prisma.proposal.deleteMany({
    where: { lead: { company: { name: { startsWith: companyPrefix } } } }
  });
  await prisma.message.deleteMany({
    where: { conversation: { lead: { company: { name: { startsWith: companyPrefix } } } } }
  });
  await prisma.conversation.deleteMany({
    where: { lead: { company: { name: { startsWith: companyPrefix } } } }
  });
  await prisma.activity.deleteMany({
    where: { lead: { company: { name: { startsWith: companyPrefix } } } }
  });
  await prisma.auditEvent.deleteMany({
    where: {
      OR: [
        { entityType: { in: ["Proposal", "HumanTakeover", "NegotiationHandoff"] } },
        { action: { startsWith: "R19_" } }
      ]
    }
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
        firstName: "R19",
        lastName: "Admin",
        role: UserRole.ADMIN,
        status: UserStatus.ACTIVE
      }
    }),
    prisma.user.create({
      data: {
        email: repEmail,
        passwordHash,
        firstName: "R19",
        lastName: "Rep",
        role: UserRole.SALES_REP,
        status: UserStatus.ACTIVE
      }
    }),
    prisma.user.create({
      data: {
        email: otherRepEmail,
        passwordHash,
        firstName: "Other",
        lastName: "Rep",
        role: UserRole.SALES_REP,
        status: UserStatus.ACTIVE
      }
    })
  ]);
  return { adminId: admin.id, repId: rep.id, otherRepId: otherRep.id };
}

async function seedLead(input: {
  ownerId: string | null;
  suffix: string;
}): Promise<{ leadId: string; contactId: string; conversationId: string }> {
  const stage = await prisma.pipelineStage.findUniqueOrThrow({ where: { key: "NEW" } });
  const company = await prisma.company.create({
    data: {
      name: `${companyPrefix} ${input.suffix}`,
      website: `https://r19-${input.suffix}.example`
    }
  });
  const contact = await prisma.contact.create({
    data: {
      companyId: company.id,
      firstName: "R19",
      lastName: input.suffix,
      email: `r19-${input.suffix}@example.local`
    }
  });
  const lead = await prisma.lead.create({
    data: {
      companyId: company.id,
      contactId: contact.id,
      ownerId: input.ownerId,
      source: "zoho-bigin",
      stageId: stage.id,
      requirement: "Needs AI sales automation dashboard context",
      serviceInterest: "AI sales automation"
    }
  });
  const conversation = await prisma.conversation.create({
    data: { leadId: lead.id, channel: "EMAIL", mode: "HUMAN" }
  });
  await prisma.message.create({
    data: {
      conversationId: conversation.id,
      direction: "INBOUND",
      senderType: "PROSPECT",
      body: "Please review our negotiation terms."
    }
  });
  return { leadId: lead.id, contactId: contact.id, conversationId: conversation.id };
}

describe("R19 action dashboard API", () => {
  beforeEach(async () => {
    await cleanup();
  }, 45000);

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  }, 45000);

  it("requires authentication", async () => {
    await request(app).get("/api/action-dashboard").expect(401);
  });

  it("surfaces real persisted action items without dashboard-owned state", async () => {
    const users = await seedUsers();
    const lead = await seedLead({ ownerId: users.repId, suffix: "primary" });
    const otherLead = await seedLead({ ownerId: users.otherRepId, suffix: "other" });
    const adminToken = await login(adminEmail);
    const repToken = await login(repEmail);

    const proposal = await prisma.proposal.create({
      data: {
        leadId: lead.leadId,
        title: "R19 Waiting Proposal",
        status: "WAITING_APPROVAL",
        createdByUserId: users.adminId
      }
    });
    await prisma.internalNotification.create({
      data: {
        type: "NEGOTIATION_HANDOFF",
        status: "UNREAD",
        severity: "WARNING",
        title: "Negotiation handoff required",
        body: "Prospect asked for commercial terms.",
        assignedToUserId: users.repId,
        leadId: lead.leadId,
        conversationId: lead.conversationId,
        sourceEntityType: "NegotiationHandoff",
        sourceEntityId: "r19-handoff",
        idempotencyKey: "r19-dashboard:notification"
      }
    });
    await prisma.humanTakeover.create({
      data: {
        leadId: lead.leadId,
        conversationId: lead.conversationId,
        takenOverByUserId: users.adminId,
        reason: "Sales engineer is handling negotiation."
      }
    });
    await prisma.followUpSequence.create({
      data: {
        leadId: lead.leadId,
        contactId: lead.contactId,
        conversationId: lead.conversationId,
        status: "ATTENTION_REQUIRED",
        cadenceDays: [0, 1, 5, 9],
        lastErrorCode: "PROVIDER_ERROR",
        lastErrorMessage: "Provider rejected follow-up dispatch.",
        idempotencyKey: "r19-dashboard:sequence"
      }
    });
    await prisma.proposal.create({
      data: {
        leadId: otherLead.leadId,
        title: "Other Rep Waiting Proposal",
        status: "WAITING_APPROVAL",
        createdByUserId: users.adminId
      }
    });

    const adminResponse = await request(app)
      .get("/api/action-dashboard")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);
    const adminDashboard = adminResponse.body as SalesActionDashboardDto;

    expect(
      adminDashboard.pendingProposalApprovals.some((item) => item.proposalId === proposal.id)
    ).toBe(true);
    expect(
      adminDashboard.negotiationAndTakeoverAlerts.some(
        (item) => item.type === "NEGOTIATION_HANDOFF"
      )
    ).toBe(true);
    expect(
      adminDashboard.negotiationAndTakeoverAlerts.some((item) => item.type === "HUMAN_TAKEOVER")
    ).toBe(true);
    expect(adminDashboard.failuresRequiringAttention).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceEntityType: "FollowUpSequence",
          status: "ATTENTION_REQUIRED"
        })
      ])
    );
    expect(["AVAILABLE", "NOT_AVAILABLE"]).toContain(adminDashboard.meetings.status);
    expect(adminDashboard.meetings.items.every((item) => item.sourceEntityType === "MeetingRequest")).toBe(true);

    const repResponse = await request(app)
      .get("/api/action-dashboard")
      .set("Authorization", `Bearer ${repToken}`)
      .expect(200);
    const repDashboard = repResponse.body as SalesActionDashboardDto;

    expect(repDashboard.actionItems.every((item) => item.leadId !== otherLead.leadId)).toBe(true);
    expect(repDashboard.summary.totalActionItems).toBeGreaterThan(0);
  }, 45000);
});
