import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { AuthResponse, CompanyDto, ContactDto } from "@shilabs/shared-types";
import { createApp } from "../../app.js";
import { prisma } from "../../shared/prisma.js";
import { hashPassword } from "../auth/auth.service.js";

const app = createApp();
const ownerEmail = "phase0-owner@example.local";
const otherEmail = "phase0-other@example.local";
const companyName = "Phase0 Authorization Company";

async function cleanup(): Promise<void> {
  await prisma.authSession.deleteMany({
    where: { user: { email: { in: [ownerEmail, otherEmail] } } }
  });
  const company = await prisma.company.findFirst({ where: { name: companyName } });
  if (company) {
    await prisma.deal.deleteMany({ where: { lead: { companyId: company.id } } });
    await prisma.message.deleteMany({
      where: { conversation: { lead: { companyId: company.id } } }
    });
    await prisma.conversation.deleteMany({ where: { lead: { companyId: company.id } } });
    await prisma.activity.deleteMany({ where: { lead: { companyId: company.id } } });
    await prisma.auditEvent.deleteMany({
      where: { entityType: { in: ["Lead", "Deal", "Conversation"] } }
    });
    await prisma.lead.deleteMany({ where: { companyId: company.id } });
    await prisma.contact.deleteMany({ where: { companyId: company.id } });
    await prisma.company.delete({ where: { id: company.id } });
  }
  await prisma.user.deleteMany({ where: { email: { in: [ownerEmail, otherEmail] } } });
}

async function login(email: string): Promise<string> {
  const response = await request(app)
    .post("/api/auth/login")
    .send({ email, password: "CorrectHorse123!" })
    .expect(200);
  return (response.body as AuthResponse).accessToken;
}

describe("Phase 0 CRM object authorization", () => {
  beforeEach(async () => {
    await cleanup();
    const passwordHash = await hashPassword("CorrectHorse123!");
    const [owner, other] = await Promise.all([
      prisma.user.create({
        data: {
          email: ownerEmail,
          passwordHash,
          firstName: "Record",
          lastName: "Owner",
          role: "SALES_REP"
        }
      }),
      prisma.user.create({
        data: {
          email: otherEmail,
          passwordHash,
          firstName: "Other",
          lastName: "Rep",
          role: "SALES_REP"
        }
      })
    ]);
    const stage = await prisma.pipelineStage.findUniqueOrThrow({ where: { key: "NEW" } });
    const company = await prisma.company.create({ data: { name: companyName } });
    const contact = await prisma.contact.create({
      data: { companyId: company.id, firstName: "Private", lastName: "Contact" }
    });
    const lead = await prisma.lead.create({
      data: {
        companyId: company.id,
        contactId: contact.id,
        ownerId: owner.id,
        stageId: stage.id,
        source: "phase0-authorization"
      }
    });
    await prisma.deal.create({
      data: {
        leadId: lead.id,
        stageId: stage.id,
        ownerId: owner.id,
        probability: stage.probability
      }
    });
    await prisma.conversation.create({
      data: { leadId: lead.id, channel: "EMAIL", mode: "AUTO" }
    });
    expect(other.id).not.toBe(owner.id);
  }, 45000);

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  }, 45000);

  it("filters parent records and rejects nested access for another salesperson", async () => {
    const token = await login(otherEmail);
    const company = await prisma.company.findFirstOrThrow({ where: { name: companyName } });
    const contact = await prisma.contact.findFirstOrThrow({ where: { companyId: company.id } });
    const lead = await prisma.lead.findFirstOrThrow({ where: { companyId: company.id } });
    const deal = await prisma.deal.findUniqueOrThrow({ where: { leadId: lead.id } });
    const conversation = await prisma.conversation.findFirstOrThrow({ where: { leadId: lead.id } });

    const companies = await request(app)
      .get("/api/companies")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    expect((companies.body as CompanyDto[]).some((item) => item.id === company.id)).toBe(false);

    const contacts = await request(app)
      .get("/api/contacts")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    expect((contacts.body as ContactDto[]).some((item) => item.id === contact.id)).toBe(false);

    await request(app)
      .get(`/api/companies/${company.id}`)
      .set("Authorization", `Bearer ${token}`)
      .expect(403);
    await request(app)
      .patch(`/api/companies/${company.id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Unauthorized change" })
      .expect(403);
    await request(app)
      .get(`/api/contacts/${contact.id}`)
      .set("Authorization", `Bearer ${token}`)
      .expect(403);
    await request(app)
      .patch(`/api/contacts/${contact.id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ title: "Changed" })
      .expect(403);
    await request(app)
      .get(`/api/deals/${deal.id}`)
      .set("Authorization", `Bearer ${token}`)
      .expect(403);
    await request(app)
      .patch(`/api/deals/${deal.id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ probability: 50 })
      .expect(403);
    await request(app)
      .get(`/api/conversations/${conversation.id}`)
      .set("Authorization", `Bearer ${token}`)
      .expect(403);
    await request(app)
      .get(`/api/conversations/${conversation.id}/messages`)
      .set("Authorization", `Bearer ${token}`)
      .expect(403);
    await request(app)
      .post("/api/conversations")
      .set("Authorization", `Bearer ${token}`)
      .send({ leadId: lead.id, channel: "EMAIL" })
      .expect(403);
    await request(app)
      .post("/api/leads")
      .set("Authorization", `Bearer ${token}`)
      .send({ companyId: company.id, contactId: contact.id, source: "phase0-unauthorized" })
      .expect(403);
  }, 45000);
});
