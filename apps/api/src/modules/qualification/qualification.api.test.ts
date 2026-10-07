import { randomUUID } from "node:crypto";
import request from "supertest";
import { UserRole, UserStatus } from "@prisma/client";
import type { AuthResponse, LeadQualificationDto } from "@shilabs/shared-types";
import { createApp } from "../../app.js";
import { prisma } from "../../shared/prisma.js";
import { hashPassword } from "../auth/auth.service.js";

const app = createApp();
const adminEmail = "qualification-api-admin@example.local";
const companyNamePrefix = "M10 Qualification API Company";

async function seedStages(): Promise<void> {
  await prisma.pipelineStage.upsert({
    where: { key: "NEW" },
    create: {
      key: "NEW",
      label: "New",
      order: 10,
      probability: 5,
      isClosed: false,
      isWon: false,
      isLost: false
    },
    update: {}
  });
}

async function login(): Promise<string> {
  const response = await request(app)
    .post("/api/auth/login")
    .send({ email: adminEmail, password: "CorrectHorse123!" })
    .expect(200);
  return (response.body as unknown as AuthResponse).accessToken;
}

async function cleanup(): Promise<void> {
  await prisma.authSession.deleteMany({ where: { user: { email: adminEmail } } });
  await prisma.leadQualificationEvidence.deleteMany({
    where: { qualification: { lead: { company: { name: { startsWith: companyNamePrefix } } } } }
  });
  await prisma.leadQualification.deleteMany({
    where: { lead: { company: { name: { startsWith: companyNamePrefix } } } }
  });
  await prisma.message.deleteMany({
    where: { conversation: { lead: { company: { name: { startsWith: companyNamePrefix } } } } }
  });
  await prisma.conversation.deleteMany({
    where: { lead: { company: { name: { startsWith: companyNamePrefix } } } }
  });
  await prisma.activity.deleteMany({
    where: { lead: { company: { name: { startsWith: companyNamePrefix } } } }
  });
  await prisma.auditEvent.deleteMany({ where: { entityType: "LeadQualification" } });
  await prisma.lead.deleteMany({ where: { company: { name: { startsWith: companyNamePrefix } } } });
  await prisma.contact.deleteMany({
    where: { company: { name: { startsWith: companyNamePrefix } } }
  });
  await prisma.company.deleteMany({ where: { name: { startsWith: companyNamePrefix } } });
  await prisma.user.deleteMany({ where: { email: adminEmail } });
}

async function createLeadAndMessage(): Promise<{ leadId: string; messageId: string }> {
  const user = await prisma.user.findUniqueOrThrow({ where: { email: adminEmail } });
  const workspace = await prisma.workspace.findUniqueOrThrow({ where: { slug: "default" } });
  const uniqueSlug = `m10-api-${randomUUID()}`;
  const company = await prisma.company.create({
    data: { workspaceId: workspace.id, name: `${companyNamePrefix} ${uniqueSlug}` }
  });
  const contact = await prisma.contact.create({
    data: {
      workspaceId: workspace.id,
      companyId: company.id,
      firstName: "API",
      lastName: "Prospect",
      email: `${uniqueSlug}@example.local`
    }
  });
  const stage = await prisma.pipelineStage.findUniqueOrThrow({ where: { key: "NEW" } });
  const lead = await prisma.lead.create({
    data: {
      workspaceId: workspace.id,
      companyId: company.id,
      contactId: contact.id,
      ownerId: user.id,
      stageId: stage.id,
      source: "website"
    }
  });
  const conversation = await prisma.conversation.create({
    data: { workspaceId: workspace.id, leadId: lead.id, channel: "WEBSITE" }
  });
  const message = await prisma.message.create({
    data: {
      workspaceId: workspace.id,
      conversationId: conversation.id,
      direction: "INBOUND",
      senderType: "PROSPECT",
      body: "We need a new website and the owner is reviewing it."
    }
  });
  return { leadId: lead.id, messageId: message.id };
}

describe("M10 qualification API", () => {
  beforeEach(async () => {
    await seedStages();
    await cleanup();
    await prisma.user.create({
      data: {
        email: adminEmail,
        passwordHash: await hashPassword("CorrectHorse123!"),
        firstName: "Qualification",
        lastName: "API Admin",
        role: UserRole.ADMIN,
        status: UserStatus.ACTIVE
      }
    });
  }, 45000);

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  }, 45000);

  it("requires auth and returns empty qualification fields for a lead", async () => {
    const token = await login();
    const { leadId } = await createLeadAndMessage();

    await request(app).get(`/api/leads/${leadId}/qualification`).expect(401);
    const response = await request(app)
      .get(`/api/leads/${leadId}/qualification`)
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    const qualification = response.body as unknown as LeadQualificationDto;

    expect(qualification.leadId).toBe(leadId);
    expect(qualification.id).toBeNull();
    expect(qualification.need).toBeNull();
  }, 45000);

  it("persists human corrections with validated evidence", async () => {
    const token = await login();
    const { leadId, messageId } = await createLeadAndMessage();

    const response = await request(app)
      .patch(`/api/leads/${leadId}/qualification`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        need: "website",
        authority: "owner is reviewing",
        evidence: [{ messageId, quote: "owner is reviewing" }]
      })
      .expect(200);
    const qualification = response.body as unknown as LeadQualificationDto;

    expect(qualification.need).toBe("website");
    expect(qualification.authority).toBe("owner is reviewing");
    expect(qualification.evidence).toHaveLength(1);
    await request(app)
      .patch(`/api/leads/${leadId}/qualification`)
      .set("Authorization", `Bearer ${token}`)
      .send({ evidence: [{ messageId, quote: "not in message" }] })
      .expect(400);
  }, 45000);
});
