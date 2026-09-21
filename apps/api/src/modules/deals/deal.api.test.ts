import { randomUUID } from "node:crypto";
import request from "supertest";
import { UserRole, UserStatus } from "@prisma/client";
import type {
  ActivityDto,
  AuthResponse,
  CompanyDto,
  ContactDto,
  DealDto,
  LeadDto,
  PipelineStageDto
} from "@shilabs/shared-types";
import { createApp } from "../../app.js";
import { prisma } from "../../shared/prisma.js";
import { hashPassword } from "../auth/auth.service.js";

const app = createApp();
const adminEmail = "crm-api-admin@example.local";
const repEmail = "crm-api-rep@example.local";
const companyNamePrefix = "M5 CRM Company";
const pipelineStages = [
  {
    key: "NEW",
    label: "New",
    order: 10,
    probability: 5,
    isClosed: false,
    isWon: false,
    isLost: false
  },
  {
    key: "CONTACTED",
    label: "Contacted",
    order: 20,
    probability: 10,
    isClosed: false,
    isWon: false,
    isLost: false
  },
  {
    key: "ENGAGED",
    label: "Engaged",
    order: 30,
    probability: 25,
    isClosed: false,
    isWon: false,
    isLost: false
  },
  {
    key: "QUALIFIED",
    label: "Qualified",
    order: 40,
    probability: 50,
    isClosed: false,
    isWon: false,
    isLost: false
  },
  {
    key: "MEETING_BOOKED",
    label: "Meeting Booked",
    order: 50,
    probability: 60,
    isClosed: false,
    isWon: false,
    isLost: false
  },
  {
    key: "PROPOSAL",
    label: "Proposal",
    order: 60,
    probability: 70,
    isClosed: false,
    isWon: false,
    isLost: false
  },
  {
    key: "NEGOTIATION",
    label: "Negotiation",
    order: 70,
    probability: 85,
    isClosed: false,
    isWon: false,
    isLost: false
  },
  {
    key: "WON",
    label: "Won",
    order: 80,
    probability: 100,
    isClosed: true,
    isWon: true,
    isLost: false
  },
  {
    key: "LOST",
    label: "Lost",
    order: 90,
    probability: 0,
    isClosed: true,
    isWon: false,
    isLost: true
  },
  {
    key: "NURTURE",
    label: "Nurture",
    order: 100,
    probability: 15,
    isClosed: false,
    isWon: false,
    isLost: false
  }
] as const;

async function seedStages(): Promise<void> {
  for (const stage of pipelineStages) {
    await prisma.pipelineStage.upsert({
      where: { key: stage.key },
      create: stage,
      update: stage
    });
  }
}

async function login(email: string): Promise<string> {
  const response = await request(app)
    .post("/api/auth/login")
    .send({ email, password: "CorrectHorse123!" })
    .expect(200);
  const body = response.body as unknown as AuthResponse;
  return body.accessToken;
}

async function createIdentity(
  token: string
): Promise<{ company: CompanyDto; contact: ContactDto }> {
  const uniqueSlug = `m5-crm-${randomUUID()}`;
  const companyResponse = await request(app)
    .post("/api/companies")
    .set("Authorization", `Bearer ${token}`)
    .send({
      name: `${companyNamePrefix} ${uniqueSlug}`,
      website: `https://${uniqueSlug}.example`
    })
    .expect(201);
  const company = companyResponse.body as unknown as CompanyDto;

  const contactResponse = await request(app)
    .post("/api/contacts")
    .set("Authorization", `Bearer ${token}`)
    .send({
      companyId: company.id,
      firstName: "CRM",
      lastName: "Contact",
      email: `${uniqueSlug}@example.local`
    })
    .expect(201);

  return {
    company,
    contact: contactResponse.body as unknown as ContactDto
  };
}

async function createLead(token: string): Promise<LeadDto> {
  const { company, contact } = await createIdentity(token);
  const response = await request(app)
    .post("/api/leads")
    .set("Authorization", `Bearer ${token}`)
    .send({
      companyId: company.id,
      contactId: contact.id,
      source: "website",
      requirement: "Needs a sales-ready CRM implementation",
      serviceInterest: "CRM"
    })
    .expect(201);

  const body: unknown = response.body;
  return body as LeadDto;
}

async function stageByKey(key: string): Promise<PipelineStageDto> {
  const stage = await prisma.pipelineStage.findUniqueOrThrow({ where: { key } });
  return {
    id: stage.id,
    key: stage.key,
    label: stage.label,
    order: stage.order,
    probability: stage.probability,
    isClosed: stage.isClosed,
    isWon: stage.isWon,
    isLost: stage.isLost
  };
}

describe("M5 CRM pipeline and deals API", () => {
  beforeEach(async () => {
    await seedStages();
    await prisma.authSession.deleteMany({
      where: {
        user: {
          email: {
            in: [adminEmail, repEmail]
          }
        }
      }
    });
    await prisma.auditEvent.deleteMany({
      where: {
        OR: [{ entityType: "Lead" }, { entityType: "Deal" }]
      }
    });
    await prisma.deal.deleteMany({
      where: {
        lead: {
          company: {
            name: { startsWith: companyNamePrefix }
          }
        }
      }
    });
    await prisma.activity.deleteMany({
      where: {
        lead: {
          company: {
            name: { startsWith: companyNamePrefix }
          }
        }
      }
    });
    await prisma.lead.deleteMany({
      where: {
        company: {
          name: { startsWith: companyNamePrefix }
        }
      }
    });
    await prisma.contact.deleteMany({
      where: {
        company: {
          name: { startsWith: companyNamePrefix }
        }
      }
    });
    await prisma.company.deleteMany({
      where: {
        name: { startsWith: companyNamePrefix }
      }
    });
    await prisma.user.deleteMany({
      where: {
        email: {
          in: [adminEmail, repEmail]
        }
      }
    });

    const passwordHash = await hashPassword("CorrectHorse123!");
    await prisma.user.createMany({
      data: [
        {
          email: adminEmail,
          passwordHash,
          firstName: "CRM",
          lastName: "Admin",
          role: UserRole.ADMIN,
          status: UserStatus.ACTIVE
        },
        {
          email: repEmail,
          passwordHash,
          firstName: "CRM",
          lastName: "Rep",
          role: UserRole.SALES_REP,
          status: UserStatus.ACTIVE
        }
      ]
    });
  });

  afterAll(async () => {
    await prisma.authSession.deleteMany({
      where: {
        user: {
          email: {
            in: [adminEmail, repEmail]
          }
        }
      }
    });
    await prisma.deal.deleteMany({
      where: {
        lead: {
          company: {
            name: { startsWith: companyNamePrefix }
          }
        }
      }
    });
    await prisma.activity.deleteMany({
      where: {
        lead: {
          company: {
            name: { startsWith: companyNamePrefix }
          }
        }
      }
    });
    await prisma.auditEvent.deleteMany({
      where: {
        OR: [{ entityType: "Lead" }, { entityType: "Deal" }]
      }
    });
    await prisma.lead.deleteMany({
      where: {
        company: {
          name: { startsWith: companyNamePrefix }
        }
      }
    });
    await prisma.contact.deleteMany({
      where: {
        company: {
          name: { startsWith: companyNamePrefix }
        }
      }
    });
    await prisma.company.deleteMany({
      where: {
        name: { startsWith: companyNamePrefix }
      }
    });
    await prisma.user.deleteMany({
      where: {
        email: {
          in: [adminEmail, repEmail]
        }
      }
    });
    await prisma.$disconnect();
  });

  it("lists pipeline stages in configured order", async () => {
    const token = await login(adminEmail);

    const response = await request(app)
      .get("/api/pipeline/stages")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    const stages = response.body as unknown as PipelineStageDto[];

    expect(stages.map((stage) => stage.key)).toEqual([
      "NEW",
      "CONTACTED",
      "ENGAGED",
      "QUALIFIED",
      "MEETING_BOOKED",
      "PROPOSAL",
      "NEGOTIATION",
      "WON",
      "LOST",
      "NURTURE"
    ]);
    expect(stages.map((stage) => stage.order)).toEqual([10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
  }, 45000);

  it("changes a lead stage and records activity plus audit history", async () => {
    const token = await login(adminEmail);
    const lead = await createLead(token);
    const qualifiedStage = await stageByKey("QUALIFIED");

    const response = await request(app)
      .patch(`/api/leads/${lead.id}/stage`)
      .set("Authorization", `Bearer ${token}`)
      .send({ stageId: qualifiedStage.id })
      .expect(200);
    const updated = response.body as unknown as LeadDto;

    expect(updated.stage.key).toBe("QUALIFIED");
    expect(updated.status).toBe("OPEN");

    const activitiesResponse = await request(app)
      .get(`/api/leads/${lead.id}/activities`)
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    const activities = activitiesResponse.body as unknown as ActivityDto[];

    expect(activities.some((activity) => activity.type === "STAGE_CHANGED")).toBe(true);
    await prisma.auditEvent.findFirstOrThrow({
      where: {
        entityType: "Lead",
        entityId: lead.id,
        action: "STAGE_CHANGED"
      }
    });
  }, 45000);

  it("rejects reopening a closed won lead through the normal stage endpoint", async () => {
    const token = await login(adminEmail);
    const lead = await createLead(token);
    const wonStage = await stageByKey("WON");
    const newStage = await stageByKey("NEW");

    await request(app)
      .patch(`/api/leads/${lead.id}/stage`)
      .set("Authorization", `Bearer ${token}`)
      .send({ stageId: wonStage.id })
      .expect(200);

    await request(app)
      .patch(`/api/leads/${lead.id}/stage`)
      .set("Authorization", `Bearer ${token}`)
      .send({ stageId: newStage.id })
      .expect(409);
  }, 45000);

  it("creates deals with default probability from the selected stage", async () => {
    const token = await login(adminEmail);
    const lead = await createLead(token);
    const proposalStage = await stageByKey("PROPOSAL");

    const response = await request(app)
      .post("/api/deals")
      .set("Authorization", `Bearer ${token}`)
      .send({
        leadId: lead.id,
        stageId: proposalStage.id,
        value: "7500",
        currency: "USD"
      })
      .expect(201);
    const deal = response.body as unknown as DealDto;

    expect(deal.leadId).toBe(lead.id);
    expect(deal.stage.key).toBe("PROPOSAL");
    expect(deal.probability).toBe(70);
    expect(deal.status).toBe("OPEN");

    const fetchedResponse = await request(app)
      .get(`/api/deals/${deal.id}`)
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    const fetched = fetchedResponse.body as unknown as DealDto;

    expect(fetched.id).toBe(deal.id);
    await prisma.auditEvent.findFirstOrThrow({
      where: {
        entityType: "Deal",
        entityId: deal.id,
        action: "DEAL_CREATED"
      }
    });
  }, 45000);

  it("updates deal value and defaults probability when the deal stage changes", async () => {
    const token = await login(adminEmail);
    const lead = await createLead(token);
    const proposalStage = await stageByKey("PROPOSAL");
    const negotiationStage = await stageByKey("NEGOTIATION");
    const createResponse = await request(app)
      .post("/api/deals")
      .set("Authorization", `Bearer ${token}`)
      .send({
        leadId: lead.id,
        stageId: proposalStage.id,
        value: "7500",
        currency: "USD"
      })
      .expect(201);
    const deal = createResponse.body as unknown as DealDto;

    const updateResponse = await request(app)
      .patch(`/api/deals/${deal.id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        stageId: negotiationStage.id,
        value: "9500",
        proposalStatus: "SENT"
      })
      .expect(200);
    const updated = updateResponse.body as unknown as DealDto;

    expect(updated.value).toBe("9500");
    expect(updated.stage.key).toBe("NEGOTIATION");
    expect(updated.probability).toBe(85);
    expect(updated.proposalStatus).toBe("SENT");

    const activity = await prisma.activity.findFirstOrThrow({
      where: {
        leadId: lead.id,
        type: "DEAL_UPDATED"
      }
    });
    expect(activity.actorUserId).toBeTruthy();

    await prisma.auditEvent.findFirstOrThrow({
      where: {
        entityType: "Deal",
        entityId: deal.id,
        action: "DEAL_UPDATED"
      }
    });
  }, 45000);
});
