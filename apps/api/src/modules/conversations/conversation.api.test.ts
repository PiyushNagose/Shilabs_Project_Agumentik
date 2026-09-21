import { randomUUID } from "node:crypto";
import request from "supertest";
import { UserRole, UserStatus } from "@prisma/client";
import type { AuthResponse, ConversationDto, LeadDto, MessageDto } from "@shilabs/shared-types";
import { createApp } from "../../app.js";
import { prisma } from "../../shared/prisma.js";
import { hashPassword } from "../auth/auth.service.js";

const app = createApp();
const adminEmail = "conversation-api-admin@example.local";
const companyNamePrefix = "M7 Conversation Company";
const newStage = {
  key: "NEW",
  label: "New",
  order: 10,
  probability: 5,
  isClosed: false,
  isWon: false,
  isLost: false
};

async function seedStages(): Promise<void> {
  await prisma.pipelineStage.upsert({
    where: { key: newStage.key },
    create: newStage,
    update: newStage
  });
}

async function login(): Promise<string> {
  const response = await request(app)
    .post("/api/auth/login")
    .send({ email: adminEmail, password: "CorrectHorse123!" })
    .expect(200);
  const body = response.body as unknown as AuthResponse;
  return body.accessToken;
}

async function createLead(token: string): Promise<LeadDto> {
  const uniqueSlug = `m7-conversations-${randomUUID()}`;
  const companyResponse = await request(app)
    .post("/api/companies")
    .set("Authorization", `Bearer ${token}`)
    .send({
      name: `${companyNamePrefix} ${uniqueSlug}`,
      website: `https://${uniqueSlug}.example`
    })
    .expect(201);
  const company = companyResponse.body as { id: string };

  const contactResponse = await request(app)
    .post("/api/contacts")
    .set("Authorization", `Bearer ${token}`)
    .send({
      companyId: company.id,
      firstName: "Conversation",
      lastName: "Prospect",
      email: `${uniqueSlug}@example.local`
    })
    .expect(201);
  const contact = contactResponse.body as { id: string };

  const leadResponse = await request(app)
    .post("/api/leads")
    .set("Authorization", `Bearer ${token}`)
    .send({
      companyId: company.id,
      contactId: contact.id,
      source: "website",
      requirement: "Needs a conversation inbox"
    })
    .expect(201);

  const body: unknown = leadResponse.body;
  return body as LeadDto;
}

async function cleanup(): Promise<void> {
  await prisma.authSession.deleteMany({ where: { user: { email: adminEmail } } });
  await prisma.message.deleteMany({
    where: { conversation: { lead: { company: { name: { startsWith: companyNamePrefix } } } } }
  });
  await prisma.conversation.deleteMany({
    where: { lead: { company: { name: { startsWith: companyNamePrefix } } } }
  });
  await prisma.auditEvent.deleteMany({
    where: {
      OR: [
        { entityType: "Conversation" },
        { entityType: "Lead" },
        { entityType: "Company" },
        { entityType: "Contact" }
      ]
    }
  });
  await prisma.activity.deleteMany({
    where: { lead: { company: { name: { startsWith: companyNamePrefix } } } }
  });
  await prisma.deal.deleteMany({
    where: { lead: { company: { name: { startsWith: companyNamePrefix } } } }
  });
  await prisma.lead.deleteMany({
    where: { company: { name: { startsWith: companyNamePrefix } } }
  });
  await prisma.contact.deleteMany({
    where: { company: { name: { startsWith: companyNamePrefix } } }
  });
  await prisma.company.deleteMany({ where: { name: { startsWith: companyNamePrefix } } });
  await prisma.user.deleteMany({ where: { email: adminEmail } });
}

describe("M7/M8 conversations API", () => {
  beforeEach(async () => {
    await seedStages();
    await cleanup();
    await prisma.user.create({
      data: {
        email: adminEmail,
        passwordHash: await hashPassword("CorrectHorse123!"),
        firstName: "Conversation",
        lastName: "Admin",
        role: UserRole.ADMIN,
        status: UserStatus.ACTIVE
      }
    });
  }, 45000);

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  }, 45000);

  it("creates and reads a conversation for a real lead", async () => {
    const token = await login();
    const lead = await createLead(token);

    const createResponse = await request(app)
      .post("/api/conversations")
      .set("Authorization", `Bearer ${token}`)
      .send({ leadId: lead.id, channel: "WEBSITE", mode: "AUTO" })
      .expect(201);
    const conversation = createResponse.body as unknown as ConversationDto;

    expect(conversation.leadId).toBe(lead.id);
    expect(conversation.channel).toBe("WEBSITE");
    expect(conversation.mode).toBe("AUTO");

    const getResponse = await request(app)
      .get(`/api/conversations/${conversation.id}`)
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    const fetched = getResponse.body as unknown as ConversationDto;

    expect(fetched.id).toBe(conversation.id);
  }, 45000);

  it("appends messages in order and updates lastMessageAt", async () => {
    const token = await login();
    const lead = await createLead(token);
    const conversationResponse = await request(app)
      .post("/api/conversations")
      .set("Authorization", `Bearer ${token}`)
      .send({ leadId: lead.id, channel: "WEBSITE" })
      .expect(201);
    const conversation = conversationResponse.body as unknown as ConversationDto;

    await request(app)
      .post(`/api/conversations/${conversation.id}/messages`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        direction: "INBOUND",
        senderType: "PROSPECT",
        body: "We need a new website."
      })
      .expect(201);
    await request(app)
      .post(`/api/conversations/${conversation.id}/messages`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        direction: "OUTBOUND",
        senderType: "USER",
        body: "Thanks, can you share your timeline?"
      })
      .expect(201);

    const messagesResponse = await request(app)
      .get(`/api/conversations/${conversation.id}/messages`)
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    const messages = messagesResponse.body as unknown as MessageDto[];

    expect(messages.map((message) => message.body)).toEqual([
      "We need a new website.",
      "Thanks, can you share your timeline?"
    ]);

    const updatedConversation = await prisma.conversation.findUniqueOrThrow({
      where: { id: conversation.id }
    });
    expect(updatedConversation.lastMessageAt).toBeInstanceOf(Date);

    const activities = await prisma.activity.findMany({
      where: { leadId: lead.id },
      orderBy: { createdAt: "asc" }
    });
    expect(activities.map((activity) => activity.type)).toContain("MESSAGE_RECEIVED");
    expect(activities.map((activity) => activity.type)).toContain("MESSAGE_SENT");
  }, 45000);

  it("changes conversation mode and writes audit history", async () => {
    const token = await login();
    const lead = await createLead(token);
    const conversationResponse = await request(app)
      .post("/api/conversations")
      .set("Authorization", `Bearer ${token}`)
      .send({ leadId: lead.id, channel: "WEBSITE" })
      .expect(201);
    const conversation = conversationResponse.body as unknown as ConversationDto;

    const modeResponse = await request(app)
      .patch(`/api/conversations/${conversation.id}/mode`)
      .set("Authorization", `Bearer ${token}`)
      .send({ mode: "HUMAN" })
      .expect(200);
    const updated = modeResponse.body as unknown as ConversationDto;

    expect(updated.mode).toBe("HUMAN");
    await prisma.auditEvent.findFirstOrThrow({
      where: {
        entityType: "Conversation",
        entityId: conversation.id,
        action: "AI_MODE_CHANGED"
      }
    });
  }, 45000);

  it("prevents duplicate provider message ids", async () => {
    const token = await login();
    const lead = await createLead(token);
    const conversationResponse = await request(app)
      .post("/api/conversations")
      .set("Authorization", `Bearer ${token}`)
      .send({ leadId: lead.id, channel: "WEBSITE" })
      .expect(201);
    const conversation = conversationResponse.body as unknown as ConversationDto;

    await request(app)
      .post(`/api/conversations/${conversation.id}/messages`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        providerMessageId: "provider-message-1",
        direction: "INBOUND",
        senderType: "PROSPECT",
        body: "First copy"
      })
      .expect(201);

    await request(app)
      .post(`/api/conversations/${conversation.id}/messages`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        providerMessageId: "provider-message-1",
        direction: "INBOUND",
        senderType: "PROSPECT",
        body: "Duplicate copy"
      })
      .expect(409);
  }, 45000);
});
