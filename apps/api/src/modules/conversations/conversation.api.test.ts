import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { UserRole, UserStatus } from "@prisma/client";
import type {
  AuthResponse,
  ConversationDto,
  HumanTakeoverBriefingDto,
  HumanTakeoverDto,
  LeadDto,
  MessageDto
} from "@shilabs/shared-types";
import { createApp } from "../../app.js";
import { prisma } from "../../shared/prisma.js";
import { hashPassword } from "../auth/auth.service.js";
import type { EmailProvider, EmailSendInput, EmailSendResult } from "../email/email.provider.js";
import type { AIProvider } from "../ai/ai.provider.js";
import { sendHumanReply, sendHumanWhatsAppReply } from "./conversation.service.js";

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
const configuredEmailEnv = {
  EMAIL_PROVIDER: "AWS_SES",
  ALLOW_EXTERNAL_EMAIL_IN_NON_PRODUCTION: "true",
  AWS_SES_REGION: "us-east-1",
  AWS_SES_FROM_EMAIL: "sales@example.com",
  AWS_SES_ACCESS_KEY_ID: "test-access-key",
  AWS_SES_SECRET_ACCESS_KEY: "test-secret-key",
  AWS_SES_WEBHOOK_SECRET: "test-webhook-secret",
  AWS_SES_USE_DEFAULT_CREDENTIAL_CHAIN: "false"
};

class TestEmailProvider implements EmailProvider {
  public sendEmailMock = vi.fn((input: EmailSendInput): Promise<EmailSendResult> =>
    Promise.resolve({
      provider: "AWS_SES",
      providerMessageId: `ses-human-${input.idempotencyKey}`
    })
  );
  public verifyConnection: EmailProvider["verifyConnection"] = () =>
    Promise.resolve({ provider: "AWS_SES", sendingEnabled: true });
  public sendEmail(input: EmailSendInput): Promise<EmailSendResult> {
    return this.sendEmailMock(input);
  }
}

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
  const companies = await prisma.company.findMany({
    where: { name: { startsWith: companyNamePrefix } },
    select: { id: true }
  });
  const companyIds = companies.map((company) => company.id);
  const contacts = await prisma.contact.findMany({
    where: { companyId: { in: companyIds } },
    select: { id: true }
  });
  const contactIds = contacts.map((contact) => contact.id);
  const leads = await prisma.lead.findMany({
    where: { companyId: { in: companyIds } },
    select: { id: true }
  });
  const leadIds = leads.map((lead) => lead.id);
  const conversations = await prisma.conversation.findMany({
    where: { leadId: { in: leadIds } },
    select: { id: true }
  });
  const conversationIds = conversations.map((conversation) => conversation.id);
  const takeovers = await prisma.humanTakeover.findMany({
    where: { leadId: { in: leadIds } },
    select: { id: true }
  });
  const takeoverIds = takeovers.map((takeover) => takeover.id);
  const followUpSequences = await prisma.followUpSequence.findMany({
    where: { leadId: { in: leadIds } },
    select: { id: true }
  });
  const followUpSequenceIds = followUpSequences.map((sequence) => sequence.id);
  const followUpAttempts = await prisma.followUpAttempt.findMany({
    where: { leadId: { in: leadIds } },
    select: { id: true }
  });
  const followUpAttemptIds = followUpAttempts.map((attempt) => attempt.id);

  await prisma.authSession.deleteMany({ where: { user: { email: adminEmail } } });
  await prisma.message.deleteMany({
    where: { conversationId: { in: conversationIds } }
  });
  await prisma.whatsAppProviderEvent.deleteMany({ where: { outboundMessage: { leadId: { in: leadIds } } } });
  await prisma.outboundWhatsAppMessage.deleteMany({ where: { leadId: { in: leadIds } } });
  await prisma.humanTakeover.deleteMany({
    where: { leadId: { in: leadIds } }
  });
  await prisma.emailProviderEvent.deleteMany({
    where: { outboundEmail: { leadId: { in: leadIds } } }
  });
  await prisma.outboundEmail.deleteMany({
    where: { leadId: { in: leadIds } }
  });
  await prisma.domainEventOutbox.deleteMany({
    where: {
      OR: [
        { aggregateId: { in: leadIds } },
        { aggregateId: { in: followUpSequenceIds } },
        { aggregateId: { in: followUpAttemptIds } }
      ]
    }
  });
  await prisma.followUpAttempt.deleteMany({ where: { leadId: { in: leadIds } } });
  await prisma.followUpSequence.deleteMany({ where: { leadId: { in: leadIds } } });
  await prisma.conversation.deleteMany({
    where: { id: { in: conversationIds } }
  });
  await prisma.auditEvent.deleteMany({
    where: {
      OR: [
        { entityId: { in: companyIds } },
        { entityId: { in: contactIds } },
        { entityId: { in: leadIds } },
        { entityId: { in: conversationIds } },
        { entityId: { in: takeoverIds } }
      ]
    }
  });
  await prisma.activity.deleteMany({
    where: { leadId: { in: leadIds } }
  });
  await prisma.deal.deleteMany({
    where: { leadId: { in: leadIds } }
  });
  await prisma.lead.deleteMany({ where: { id: { in: leadIds } } });
  await prisma.contact.deleteMany({ where: { id: { in: contactIds } } });
  await prisma.company.deleteMany({ where: { id: { in: companyIds } } });
  await prisma.user.deleteMany({ where: { email: adminEmail } });
}

describe("M7/M8 conversations API", () => {
  beforeEach(async () => {
    await seedStages();
    await cleanup();
    const user = await prisma.user.create({
      data: {
        email: adminEmail,
        passwordHash: await hashPassword("CorrectHorse123!"),
        firstName: "Conversation",
        lastName: "Admin",
        role: UserRole.ADMIN,
        status: UserStatus.ACTIVE
      }
    });
    const workspace = await prisma.workspace.findUniqueOrThrow({ where: { slug: "default" } });
    await prisma.workspaceMember.create({
      data: { workspaceId: workspace.id, userId: user.id, role: "ADMIN", status: "ACTIVE" }
    });
  }, 180000);

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  }, 180000);

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
  }, 180000);

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
  }, 180000);

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
  }, 180000);

  it("starts human takeover, pauses automation and returns a grounded briefing", async () => {
    const token = await login();
    const lead = await createLead(token);
    const conversationResponse = await request(app)
      .post("/api/conversations")
      .set("Authorization", `Bearer ${token}`)
      .send({ leadId: lead.id, channel: "EMAIL" })
      .expect(201);
    const conversation = conversationResponse.body as unknown as ConversationDto;

    await request(app)
      .post(`/api/conversations/${conversation.id}/messages`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        direction: "INBOUND",
        senderType: "PROSPECT",
        body: "We need AI sales automation and pricing."
      })
      .expect(201);

    const takeoverResponse = await request(app)
      .post(`/api/conversations/${conversation.id}/takeover`)
      .set("Authorization", `Bearer ${token}`)
      .send({ reason: "Proposal and negotiation review" })
      .expect(201);
    const takeover = takeoverResponse.body as unknown as HumanTakeoverDto;

    expect(takeover.status).toBe("ACTIVE");
    expect(takeover.leadId).toBe(lead.id);
    expect(takeover.conversationId).toBe(conversation.id);

    await expect(
      prisma.conversation.findUniqueOrThrow({ where: { id: conversation.id } })
    ).resolves.toMatchObject({ mode: "HUMAN" });
    const activity = await prisma.activity.findFirstOrThrow({
      where: { leadId: lead.id, type: "HUMAN_TAKEOVER" }
    });
    expect(activity.description).toContain("Proposal");
    await prisma.auditEvent.findFirstOrThrow({
      where: {
        entityType: "HumanTakeover",
        entityId: takeover.id,
        action: "HUMAN_TAKEOVER_STARTED"
      }
    });

    const duplicateResponse = await request(app)
      .post(`/api/conversations/${conversation.id}/takeover`)
      .set("Authorization", `Bearer ${token}`)
      .send({ reason: "Duplicate click" })
      .expect(201);
    const duplicate = duplicateResponse.body as unknown as HumanTakeoverDto;
    expect(duplicate.id).toBe(takeover.id);
    await expect(
      prisma.humanTakeover.count({ where: { conversationId: conversation.id, status: "ACTIVE" } })
    ).resolves.toBe(1);

    const briefingResponse = await request(app)
      .get(`/api/conversations/${conversation.id}/takeover/briefing`)
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    const briefing = briefingResponse.body as unknown as HumanTakeoverBriefingDto;

    expect(briefing.takeover.id).toBe(takeover.id);
    expect(briefing.requirements.requirement).toBe("Needs a conversation inbox");
    expect(briefing.conversationSummary.mode).toBe("HUMAN");
    expect(briefing.conversationSummary.messageCount).toBe(1);
    expect(briefing.latestActions.map((activity) => activity.type)).toContain("HUMAN_TAKEOVER");
  }, 180000);

  it("clears active human takeover when automation is explicitly resumed", async () => {
    const token = await login();
    const lead = await createLead(token);
    const conversationResponse = await request(app)
      .post("/api/conversations")
      .set("Authorization", `Bearer ${token}`)
      .send({ leadId: lead.id, channel: "EMAIL" })
      .expect(201);
    const conversation = conversationResponse.body as unknown as ConversationDto;

    const takeoverResponse = await request(app)
      .post(`/api/conversations/${conversation.id}/takeover`)
      .set("Authorization", `Bearer ${token}`)
      .send({ reason: "Manual review" })
      .expect(201);
    const takeover = takeoverResponse.body as unknown as HumanTakeoverDto;

    const modeResponse = await request(app)
      .patch(`/api/conversations/${conversation.id}/mode`)
      .set("Authorization", `Bearer ${token}`)
      .send({ mode: "AUTO" })
      .expect(200);
    const updated = modeResponse.body as unknown as ConversationDto;

    expect(updated.mode).toBe("AUTO");
    await expect(
      prisma.humanTakeover.count({ where: { conversationId: conversation.id, status: "ACTIVE" } })
    ).resolves.toBe(0);
    await prisma.auditEvent.findFirstOrThrow({
      where: {
        entityType: "HumanTakeover",
        entityId: takeover.id,
        action: "HUMAN_TAKEOVER_ENDED"
      }
    });
    await expect(
      prisma.activity.count({
        where: {
          leadId: lead.id,
          type: "HUMAN_TAKEOVER",
          description: { contains: "AI automation resumed" }
        }
      })
    ).resolves.toBe(1);
  }, 180000);

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
  }, 180000);

  it("sends a reviewed HUMAN reply idempotently and resumes follow-up", async () => {
    const token = await login();
    const lead = await createLead(token);
    const actor = await prisma.user.findUniqueOrThrow({ where: { email: adminEmail } });
    await prisma.lead.update({ where: { id: lead.id }, data: { ownerId: actor.id } });
    const conversationResponse = await request(app)
      .post("/api/conversations")
      .set("Authorization", `Bearer ${token}`)
      .send({ leadId: lead.id, channel: "EMAIL", mode: "HUMAN" })
      .expect(201);
    const conversation = conversationResponse.body as unknown as ConversationDto;
    const provider = new TestEmailProvider();

    const input = {
      body: "Thanks for discussing commercials. I can review the scope and share a revised option.",
      subject: "Re: Commercial discussion",
      idempotencyKey: "human-reply-regression-001"
    };
    const zohoTransport = () =>
      Promise.resolve(Response.json({ data: [{ details: { id: "zoho-note-1" } }] }));
    const savedLead = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
    const reviewSequence = await prisma.followUpSequence.create({ data: {
      workspaceId: savedLead.workspaceId, leadId: lead.id, contactId: lead.contactId,
      conversationId: conversation.id, status: "ATTENTION_REQUIRED", cadenceDays: [1, 5, 9],
      idempotencyKey: `review:${lead.id}`, lastErrorCode: "AI_FOLLOW_UP_REQUIRES_REVIEW"
    } });
    const aiProvider = { generateFollowUp: () => Promise.resolve({ body: "Following up on the approved scope discussion.", requiresHumanReview: false, reason: null }) } as unknown as AIProvider;
    const first = await sendHumanReply(actor, conversation.id, input, {
      env: configuredEmailEnv,
      emailProvider: provider,
      aiProvider,
      zohoTransport
    });
    const second = await sendHumanReply(actor, conversation.id, input, {
      env: configuredEmailEnv,
      emailProvider: provider,
      aiProvider,
      zohoTransport
    });

    expect(first.outboundEmail.status).toBe("SENT");
    expect(first.message?.direction).toBe("OUTBOUND");
    expect(first.message?.senderType).toBe("USER");
    expect(first.zohoTimeline?.status).toMatch(/SYNCED|SKIPPED|FAILED|NOT_CONFIGURED/);
    expect(second.outboundEmail.id).toBe(first.outboundEmail.id);
    expect(second.message?.id).toBe(first.message?.id);
    expect(provider.sendEmailMock).toHaveBeenCalledTimes(1);
    await expect(
      prisma.lead.findUnique({
        where: { id: lead.id },
        select: { automationOwnershipState: true }
      })
    ).resolves.toMatchObject({ automationOwnershipState: "AI_ACTIVE" });
    await expect(prisma.followUpSequence.count({ where: { leadId: lead.id, status: "ACTIVE" } })).resolves.toBe(1);
    await expect(prisma.followUpSequence.findUnique({ where: { id: reviewSequence.id } })).resolves.toMatchObject({ status: "STOPPED", stopReason: "HUMAN_REVIEW_COMPLETED" });
    await expect(
      prisma.activity.count({ where: { leadId: lead.id, type: "MESSAGE_SENT" } })
    ).resolves.toBe(1);
    await expect(
      prisma.auditEvent.count({
        where: { entityType: "Message", entityId: first.message?.id, action: "HUMAN_REPLY_SENT" }
      })
    ).resolves.toBe(1);
  }, 180000);

  it("rejects human reply while conversation is still automated", async () => {
    const token = await login();
    const lead = await createLead(token);
    const actor = await prisma.user.findUniqueOrThrow({ where: { email: adminEmail } });
    const conversationResponse = await request(app)
      .post("/api/conversations")
      .set("Authorization", `Bearer ${token}`)
      .send({ leadId: lead.id, channel: "EMAIL", mode: "AUTO" })
      .expect(201);
    const conversation = conversationResponse.body as unknown as ConversationDto;

    await expect(
      sendHumanReply(
        actor,
        conversation.id,
        {
          body: "Manual reply",
          idempotencyKey: "human-reply-reject-auto"
        },
        { env: configuredEmailEnv, emailProvider: new TestEmailProvider() }
      )
    ).rejects.toMatchObject({ code: "CONFLICT" });
  }, 180000);

  it("sends a HUMAN WhatsApp reply once and resumes AI ownership", async () => {
    const token = await login();
    const lead = await createLead(token);
    const actor = await prisma.user.findUniqueOrThrow({ where: { email: adminEmail } });
    await prisma.lead.update({ where: { id: lead.id }, data: { ownerId: actor.id } });
    await prisma.contact.update({ where: { id: lead.contactId }, data: { whatsappId: "+919876543210" } });
    const conversationResponse = await request(app)
      .post("/api/conversations")
      .set("Authorization", `Bearer ${token}`)
      .send({ leadId: lead.id, channel: "WHATSAPP", mode: "HUMAN" })
      .expect(201);
    const conversation = conversationResponse.body as ConversationDto;
    await prisma.message.create({ data: {
      conversationId: conversation.id,
      workspaceId: "workspace_default",
      providerMessageId: `inbound-${randomUUID()}`,
      direction: "INBOUND",
      senderType: "PROSPECT",
      body: "Please send the revised details on WhatsApp."
    } });
    const transport = vi.fn(() => Promise.resolve(Response.json({ messages: [{ id: `wamid.${randomUUID()}` }] })));
    const aiProvider = {
      generateFollowUp: () => Promise.resolve({ body: "Following up on the revised details.", requiresHumanReview: false, reason: null })
    } as unknown as AIProvider;
    const input = { body: "Here are the revised details you requested.", idempotencyKey: `manual-${randomUUID()}` };
    const options = {
      env: {
        MESSAGING_PROVIDER: "meta_whatsapp",
        WHATSAPP_ACCESS_TOKEN: "test-token",
        WHATSAPP_PHONE_NUMBER_ID: "test-phone-id",
        NODE_ENV: "test"
      },
      transport: transport as unknown as typeof fetch,
      aiProvider
    };
    const first = await sendHumanWhatsAppReply(actor, conversation.id, input, options);
    const second = await sendHumanWhatsAppReply(actor, conversation.id, input, options);
    expect(first.status).toBe("SENT");
    expect(second.message?.id).toBe(first.message?.id);
    expect(transport).toHaveBeenCalledTimes(1);
    expect(await prisma.outboundWhatsAppMessage.count({ where: { leadId: lead.id } })).toBe(1);
    expect(await prisma.activity.count({ where: { leadId: lead.id, type: "WHATSAPP_SENT" } })).toBe(1);
    await expect(prisma.lead.findUnique({ where: { id: lead.id }, select: { automationOwnershipState: true } }))
      .resolves.toMatchObject({ automationOwnershipState: "AI_ACTIVE" });
  }, 180000);
});
