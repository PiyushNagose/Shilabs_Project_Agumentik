import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { UserRole, UserStatus, WorkspaceRole } from "@prisma/client";
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
  await prisma.outboundWhatsAppMessage.deleteMany({
    where: { lead: { company: { name: { startsWith: companyPrefix } } } }
  });
  await prisma.callingAttempt.deleteMany({
    where: { lead: { company: { name: { startsWith: companyPrefix } } } }
  });
  await prisma.callingSequence.deleteMany({
    where: { lead: { company: { name: { startsWith: companyPrefix } } } }
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
  await prisma.deal.deleteMany({ where: { lead: { company: { name: { startsWith: companyPrefix } } } } });
  await prisma.lead.deleteMany({
    where: { company: { name: { startsWith: companyPrefix } } }
  });
  await prisma.contact.deleteMany({
    where: { company: { name: { startsWith: companyPrefix } } }
  });
  await prisma.company.deleteMany({
    where: { name: { startsWith: companyPrefix } }
  });
  await prisma.workspace.deleteMany({ where: { slug: "r19-dashboard-foreign" } });
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
  const workspace = await prisma.workspace.findUniqueOrThrow({ where: { slug: "default" } });
  await prisma.workspaceMember.createMany({
    data: [
      { workspaceId: workspace.id, userId: admin.id, role: WorkspaceRole.ADMIN, status: "ACTIVE" },
      {
        workspaceId: workspace.id,
        userId: rep.id,
        role: WorkspaceRole.SALES_REP,
        status: "ACTIVE"
      },
      {
        workspaceId: workspace.id,
        userId: otherRep.id,
        role: WorkspaceRole.SALES_REP,
        status: "ACTIVE"
      }
    ]
  });
  return { adminId: admin.id, repId: rep.id, otherRepId: otherRep.id };
}

async function seedLead(input: {
  ownerId: string | null;
  suffix: string;
  workspaceId?: string;
}): Promise<{ leadId: string; contactId: string; conversationId: string; workspaceId: string }> {
  const workspace = await prisma.workspace.findUniqueOrThrow({ where: input.workspaceId ? { id: input.workspaceId } : { slug: "default" } });
  const stage = await prisma.pipelineStage.findUniqueOrThrow({ where: { key: "NEW" } });
  const company = await prisma.company.create({
    data: {
      workspaceId: workspace.id,
      name: `${companyPrefix} ${input.suffix}`,
      website: `https://r19-${input.suffix}.example`
    }
  });
  const contact = await prisma.contact.create({
    data: {
      workspaceId: workspace.id,
      companyId: company.id,
      firstName: "R19",
      lastName: input.suffix,
      email: `r19-${input.suffix}@example.local`
    }
  });
  const lead = await prisma.lead.create({
    data: {
      workspaceId: workspace.id,
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
    data: { workspaceId: workspace.id, leadId: lead.id, channel: "EMAIL", mode: "HUMAN" }
  });
  await prisma.message.create({
    data: {
      workspaceId: workspace.id,
      conversationId: conversation.id,
      direction: "INBOUND",
      senderType: "PROSPECT",
      body: "Please review our negotiation terms."
    }
  });
  return {
    leadId: lead.id,
    contactId: contact.id,
    conversationId: conversation.id,
    workspaceId: workspace.id
  };
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

  it("counts visible CRM records independently of pending actions and matches their list endpoints", async () => {
    const users = await seedUsers();
    const own = await seedLead({ ownerId: users.repId, suffix: "overview-own" });
    await seedLead({ ownerId: users.otherRepId, suffix: "overview-other" });
    const foreign = await prisma.workspace.create({ data: { name: "Foreign dashboard workspace", slug: "r19-dashboard-foreign" } });
    const foreignLead = await seedLead({ ownerId: users.repId, suffix: "overview-foreign", workspaceId: foreign.id });
    const stage = await prisma.pipelineStage.findUniqueOrThrow({ where: { key: "NEW" } });
    for (const lead of [own, foreignLead]) {
      await prisma.deal.create({ data: { workspaceId: lead.workspaceId, leadId: lead.leadId, stageId: stage.id, ownerId: users.repId, value: 100, probability: stage.probability, status: "OPEN" } });
    }
    for (const email of [adminEmail, repEmail]) {
      const token = await login(email);
      const get = (path: string) => request(app).get(path).set("Authorization", `Bearer ${token}`).expect(200);
      const dashboard = (await get("/api/action-dashboard")).body as SalesActionDashboardDto;
      const leads = (await get("/api/leads")).body as { total: number };
      const contacts = (await get("/api/contacts")).body as unknown[];
      const companies = (await get("/api/companies")).body as unknown[];
      const deals = (await get("/api/deals?status=OPEN")).body as { total: number };
      expect(dashboard.overview).toEqual({ leads: leads.total, contacts: contacts.length, companies: companies.length, openDeals: deals.total });
      expect(dashboard.overview?.openDeals).toBe(1);
      expect(dashboard.actionItems.filter((item) => [own.leadId, foreignLead.leadId].includes(item.leadId ?? ""))).toHaveLength(0);
    }
  }, 45000);

  it("explains calendar reconnects and does not recommend retrying safety-blocked automation", async () => {
    const users = await seedUsers();
    const lead = await seedLead({ ownerId: users.repId, suffix: "safe-actions" });
    await prisma.internalNotification.create({
      data: {
        workspaceId: lead.workspaceId,
        type: "MEETING_CONFIRMATION", status: "UNREAD", severity: "WARNING",
        title: "Meeting scheduling needs attention", body: "Google OAuth error: invalid_grant",
        leadId: lead.leadId, assignedToUserId: users.repId,
        sourceEntityType: "MeetingRequest", sourceEntityId: "calendar-fixture",
        idempotencyKey: "r19-dashboard:calendar-reconnect"
      }
    });
    await prisma.domainEventOutbox.createMany({
      data: ["DO_NOT_CONTACT", "TERMINAL_LEAD_STATE", "AUTOMATION_PAUSED", "HUMAN_TAKEOVER_ACTIVE", "PRIVACY_ERASURE", "AI_OWNERSHIP_INACTIVE", "AI_CONTROL_OFF", "AI_CONTROL_PAUSED", "HUMAN_INTERVENTION_REQUIRED", "INBOUND_REPLY_RECEIVED", "CONTACT_DO_NOT_CONTACT", "LEAD_STATUS_FORBIDS_OUTREACH", "MEANINGFUL_CLIENT_REPLY", "LEAD_AI_PAUSED", "LEAD_AI_OFF", "MEANINGFUL_CLIENT_REPLY:EMAIL", "MEANINGFUL_CLIENT_REPLY:WHATSAPP"].map((code) => ({
        workspaceId: lead.workspaceId, eventType: "FOLLOWUP_EMAIL_SEND_REQUESTED",
        aggregateType: "Lead", aggregateId: lead.leadId, payload: { leadId: lead.leadId },
        correlationId: lead.leadId, idempotencyKey: `r19-dashboard:safety:${code}`,
        status: "ATTENTION_REQUIRED" as const, lastErrorCode: code
      }))
    });
    const token = await login(adminEmail);
    const response = await request(app).get("/api/action-dashboard").set("Authorization", `Bearer ${token}`).expect(200);
    const dashboard = response.body as SalesActionDashboardDto;
    expect(dashboard.negotiationAndTakeoverAlerts.find((item) => item.sourceEntityId === "calendar-fixture")?.detail)
      .toBe("Reconnect the calendar account in Integrations, then try scheduling again.");
    expect(dashboard.failuresRequiringAttention.filter((item) => item.sourceEntityType === "DomainEventOutbox:FOLLOWUP_EMAIL_SEND_REQUESTED")).toEqual([]);
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
        workspaceId: lead.workspaceId,
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
    expect(
      adminDashboard.meetings.items.every((item) => item.sourceEntityType === "MeetingRequest")
    ).toBe(true);

    const repResponse = await request(app)
      .get("/api/action-dashboard")
      .set("Authorization", `Bearer ${repToken}`)
      .expect(200);
    const repDashboard = repResponse.body as SalesActionDashboardDto;

    expect(repDashboard.actionItems.every((item) => item.leadId !== otherLead.leadId)).toBe(true);
    expect(repDashboard.summary.totalActionItems).toBeGreaterThan(0);
  }, 45000);

  it("deduplicates a failed WhatsApp job when its outbound attempt already failed", async () => {
    const users = await seedUsers();
    const lead = await seedLead({ ownerId: users.repId, suffix: "whatsapp-dedupe" });
    const callingSequence = await prisma.callingSequence.create({
      data: {
        leadId: lead.leadId,
        contactId: lead.contactId,
        maxAttempts: 1,
        cadenceOffsets: [0],
        idempotencyKey: "r19-dashboard:calling-sequence"
      }
    });
    const callingAttempt = await prisma.callingAttempt.create({
      data: {
        sequenceId: callingSequence.id,
        leadId: lead.leadId,
        contactId: lead.contactId,
        attemptIndex: 0,
        scheduledAt: new Date(),
        idempotencyKey: "r19-dashboard:calling-attempt",
        status: "FAILED"
      }
    });
    await prisma.outboundWhatsAppMessage.create({
      data: {
        leadId: lead.leadId,
        contactId: lead.contactId,
        callingAttemptId: callingAttempt.id,
        provider: "TWILIO",
        toWhatsAppId: "+15555550100",
        idempotencyKey: "r19-dashboard:whatsapp-message",
        status: "FAILED",
        failureCode: "WHATSAPP_PROVIDER_ERROR",
        failureMessage: "Provider rejected the message"
      }
    });
    await prisma.domainEventOutbox.create({
      data: {
        eventType: "WHATSAPP_SEND_REQUESTED",
        aggregateType: "CallingAttempt",
        aggregateId: callingAttempt.id,
        payload: { leadId: lead.leadId, callingAttemptId: callingAttempt.id },
        correlationId: callingSequence.id,
        idempotencyKey: "r19-dashboard:whatsapp-event",
        status: "FAILED",
        lastErrorCode: "WHATSAPP_PROVIDER_ERROR",
        lastErrorMessage: "Provider rejected the message"
      }
    });

    const token = await login(adminEmail);
    const response = await request(app)
      .get("/api/action-dashboard")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    const dashboard = response.body as SalesActionDashboardDto;
    const whatsappFailures = dashboard.failuresRequiringAttention.filter(
      (item) => item.leadId === lead.leadId && item.title.toLowerCase().includes("whatsapp")
    );

    expect(whatsappFailures).toHaveLength(1);
    expect(whatsappFailures[0]?.sourceEntityType).toBe("OutboundWhatsAppMessage");
  }, 45000);
});
