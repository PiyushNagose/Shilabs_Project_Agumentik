import { randomUUID } from "node:crypto";
import request from "supertest";
import { UserRole, UserStatus } from "@prisma/client";
import type {
  AuthResponse,
  CompanyDto,
  ContactDto,
  LeadDto,
  PaginatedResponse
} from "@shilabs/shared-types";
import { createApp } from "../../app.js";
import { prisma } from "../../shared/prisma.js";
import { hashPassword } from "../auth/auth.service.js";

const app = createApp();
const adminEmail = "leads-api-admin@example.local";
const managerEmail = "leads-api-manager@example.local";
const repEmail = "leads-api-rep@example.local";
const companyNamePrefix = "M4 Lead Company";

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
  const uniqueSlug = `m4-leads-${randomUUID()}`;
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
      firstName: "Lead",
      lastName: "Contact",
      email: `${uniqueSlug}@example.local`
    })
    .expect(201);

  return {
    company,
    contact: contactResponse.body as unknown as ContactDto
  };
}

async function createLead(
  token: string,
  overrides: Partial<Record<string, unknown>> = {}
): Promise<LeadDto> {
  const { company, contact } = await createIdentity(token);
  const response = await request(app)
    .post("/api/leads")
    .set("Authorization", `Bearer ${token}`)
    .send({
      companyId: company.id,
      contactId: contact.id,
      source: "website",
      requirement: "Needs a real-estate website",
      serviceInterest: "Web development",
      estimatedValue: "5000",
      currency: "USD",
      nextAction: "Follow up",
      nextActionAt: "2026-09-15T10:00:00.000Z",
      ...overrides
    })
    .expect(201);

  const body = response.body as unknown as LeadDto;
  return body;
}

describe("leads API", () => {
  beforeEach(async () => {
    await prisma.authSession.deleteMany({
      where: {
        user: {
          email: {
            in: [adminEmail, managerEmail, repEmail]
          }
        }
      }
    });
    await prisma.auditEvent.deleteMany({
      where: {
        entityType: "Lead"
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
          in: [adminEmail, managerEmail, repEmail]
        }
      }
    });

    const passwordHash = await hashPassword("CorrectHorse123!");
    await prisma.user.createMany({
      data: [
        {
          email: adminEmail,
          passwordHash,
          firstName: "Lead",
          lastName: "Admin",
          role: UserRole.ADMIN,
          status: UserStatus.ACTIVE
        },
        {
          email: managerEmail,
          passwordHash,
          firstName: "Lead",
          lastName: "Manager",
          role: UserRole.SALES_MANAGER,
          status: UserStatus.ACTIVE
        },
        {
          email: repEmail,
          passwordHash,
          firstName: "Lead",
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
            in: [adminEmail, managerEmail, repEmail]
          }
        }
      }
    });
    await prisma.auditEvent.deleteMany({
      where: {
        entityType: "Lead"
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
          in: [adminEmail, managerEmail, repEmail]
        }
      }
    });
    await prisma.$disconnect();
  });

  it("creates a lead linked to company, contact, owner and the NEW stage", async () => {
    const token = await login(adminEmail);
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: adminEmail } });

    const lead = await createLead(token);

    expect(lead.company.name).toContain(companyNamePrefix);
    expect(lead.contact.email).toContain("@example.local");
    expect(lead.ownerId).toBe(admin.id);
    expect(lead.stage.key).toBe("NEW");
    expect(lead.status).toBe("OPEN");

    const audit = await prisma.auditEvent.findFirstOrThrow({
      where: {
        entityType: "Lead",
        entityId: lead.id,
        action: "LEAD_CREATED"
      }
    });
    expect(audit.actorId).toBe(admin.id);
  }, 30000);

  it("edits manual lead fields without changing pipeline stage", async () => {
    const token = await login(adminEmail);
    const lead = await createLead(token);

    const response = await request(app)
      .patch(`/api/leads/${lead.id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        requirement: "Needs SEO-friendly ecommerce website",
        serviceInterest: "Ecommerce",
        nextAction: "Send discovery questions",
        estimatedValue: null
      })
      .expect(200);
    const updated = response.body as unknown as LeadDto;

    expect(updated.requirement).toBe("Needs SEO-friendly ecommerce website");
    expect(updated.serviceInterest).toBe("Ecommerce");
    expect(updated.estimatedValue).toBeNull();
    expect(updated.stageId).toBe(lead.stageId);

    await prisma.auditEvent.findFirstOrThrow({
      where: {
        entityType: "Lead",
        entityId: lead.id,
        action: "LEAD_UPDATED"
      }
    });
  }, 30000);

  it("assigns leads only for admins and managers", async () => {
    const adminToken = await login(adminEmail);
    const repToken = await login(repEmail);
    const lead = await createLead(adminToken);
    const rep = await prisma.user.findUniqueOrThrow({ where: { email: repEmail } });

    await request(app)
      .patch(`/api/leads/${lead.id}/assign`)
      .set("Authorization", `Bearer ${repToken}`)
      .send({ ownerId: rep.id })
      .expect(403);

    const response = await request(app)
      .patch(`/api/leads/${lead.id}/assign`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ ownerId: rep.id })
      .expect(200);
    const assigned = response.body as unknown as LeadDto;

    expect(assigned.ownerId).toBe(rep.id);

    await prisma.auditEvent.findFirstOrThrow({
      where: {
        entityType: "Lead",
        entityId: lead.id,
        action: "LEAD_ASSIGNED"
      }
    });
  }, 30000);

  it("updates lead status and records audit history", async () => {
    const token = await login(adminEmail);
    const lead = await createLead(token);

    const response = await request(app)
      .patch(`/api/leads/${lead.id}/status`)
      .set("Authorization", `Bearer ${token}`)
      .send({ status: "NURTURE" })
      .expect(200);
    const updated = response.body as unknown as LeadDto;

    expect(updated.status).toBe("NURTURE");
    await prisma.auditEvent.findFirstOrThrow({
      where: {
        entityType: "Lead",
        entityId: lead.id,
        action: "LEAD_STATUS_CHANGED"
      }
    });
  }, 30000);

  it("supports search, filters, sorting and pagination", async () => {
    const token = await login(adminEmail);
    const rep = await prisma.user.findUniqueOrThrow({ where: { email: repEmail } });
    await createLead(token, {
      source: "website",
      requirement: "Luxury hotel website",
      serviceInterest: "Web development",
      ownerId: rep.id
    });
    await createLead(token, {
      source: "referral",
      requirement: "Mobile app consultation",
      serviceInterest: "Mobile apps"
    });

    const response = await request(app)
      .get("/api/leads")
      .query({
        search: "hotel",
        source: "website",
        ownerId: rep.id,
        page: 1,
        pageSize: 1,
        sort: "createdAt",
        direction: "desc"
      })
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    const page = response.body as unknown as PaginatedResponse<LeadDto>;

    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.requirement).toBe("Luxury hotel website");
    expect(page.total).toBe(1);
    expect(page.page).toBe(1);
    expect(page.pageSize).toBe(1);
  }, 45000);

  it("validates lead creation input", async () => {
    const token = await login(adminEmail);

    await request(app)
      .post("/api/leads")
      .set("Authorization", `Bearer ${token}`)
      .send({
        companyId: "",
        contactId: "",
        source: ""
      })
      .expect(400);
  });
});
