import request from "supertest";
import { randomUUID } from "node:crypto";
import { UserRole, UserStatus } from "@prisma/client";
import type { AuthResponse, CompanyDto, ContactDto } from "@shilabs/shared-types";
import { createApp } from "../../app.js";
import { prisma } from "../../shared/prisma.js";
import { hashPassword } from "../auth/auth.service.js";

const app = createApp();
const adminEmail = "contacts-api-admin@example.local";
const companyNamePrefix = "M3 Contact Company";

async function loginAsAdmin(): Promise<string> {
  const response = await request(app)
    .post("/api/auth/login")
    .send({ email: adminEmail, password: "CorrectHorse123!" })
    .expect(200);
  const body = response.body as unknown as AuthResponse;
  return body.accessToken;
}

async function createCompany(token: string): Promise<CompanyDto> {
  const uniqueSlug = `m3-contacts-${randomUUID()}`;
  const response = await request(app)
    .post("/api/companies")
    .set("Authorization", `Bearer ${token}`)
    .send({ name: `${companyNamePrefix} ${uniqueSlug}`, website: `https://${uniqueSlug}.example` })
    .expect(201);

  const body = response.body as unknown as CompanyDto;
  return body;
}

describe("contacts API", () => {
  beforeEach(async () => {
    await prisma.authSession.deleteMany({ where: { user: { email: adminEmail } } });
    await prisma.contact.deleteMany({
      where: {
        OR: [
          { normalizedEmail: "pat@example.local" },
          { normalizedPhone: "15551234567" },
          { whatsappId: "whatsapp-m3-1" }
        ]
      }
    });
    await prisma.company.deleteMany({
      where: {
        name: { startsWith: companyNamePrefix }
      }
    });
    await prisma.user.deleteMany({ where: { email: adminEmail } });
    await prisma.user.create({
      data: {
        email: adminEmail,
        passwordHash: await hashPassword("CorrectHorse123!"),
        firstName: "Contact",
        lastName: "Admin",
        role: UserRole.ADMIN,
        status: UserStatus.ACTIVE
      }
    });
  });

  afterAll(async () => {
    await prisma.authSession.deleteMany({ where: { user: { email: adminEmail } } });
    await prisma.contact.deleteMany({
      where: {
        OR: [
          { normalizedEmail: "pat@example.local" },
          { normalizedPhone: "15551234567" },
          { whatsappId: "whatsapp-m3-1" }
        ]
      }
    });
    await prisma.company.deleteMany({
      where: {
        name: { startsWith: companyNamePrefix }
      }
    });
    await prisma.user.deleteMany({ where: { email: adminEmail } });
    await prisma.$disconnect();
  });

  it("creates a contact linked to a company and persists do-not-contact", async () => {
    const token = await loginAsAdmin();
    const company = await createCompany(token);

    const response = await request(app)
      .post("/api/contacts")
      .set("Authorization", `Bearer ${token}`)
      .send({
        companyId: company.id,
        firstName: "Pat",
        lastName: "Prospect",
        title: "Founder",
        email: "Pat@Example.Local",
        phone: "+1 (555) 123-4567",
        whatsappId: "whatsapp-m3-1",
        source: "website",
        preferredChannel: "whatsapp",
        doNotContact: true
      })
      .expect(201);
    const contact = response.body as unknown as ContactDto;

    expect(contact.companyId).toBe(company.id);
    expect(contact.normalizedEmail).toBe("pat@example.local");
    expect(contact.normalizedPhone).toBe("15551234567");
    expect(contact.doNotContact).toBe(true);
  }, 15000);

  it("rejects duplicate contact email within the same company", async () => {
    const token = await loginAsAdmin();
    const company = await createCompany(token);

    await request(app)
      .post("/api/contacts")
      .set("Authorization", `Bearer ${token}`)
      .send({
        companyId: company.id,
        firstName: "Pat",
        lastName: "Prospect",
        email: "pat@example.local"
      })
      .expect(201);

    await request(app)
      .post("/api/contacts")
      .set("Authorization", `Bearer ${token}`)
      .send({
        companyId: company.id,
        firstName: "Patricia",
        lastName: "Duplicate",
        email: "PAT@example.local"
      })
      .expect(409);
  }, 15000);

  it("rejects duplicate contact phone within the same company", async () => {
    const token = await loginAsAdmin();
    const company = await createCompany(token);

    await request(app)
      .post("/api/contacts")
      .set("Authorization", `Bearer ${token}`)
      .send({
        companyId: company.id,
        firstName: "Pat",
        lastName: "Prospect",
        phone: "+1 555 123 4567"
      })
      .expect(201);

    await request(app)
      .post("/api/contacts")
      .set("Authorization", `Bearer ${token}`)
      .send({
        companyId: company.id,
        firstName: "Phone",
        lastName: "Duplicate",
        phone: "1-555-123-4567"
      })
      .expect(409);
  }, 15000);

  it("requires an existing company", async () => {
    const token = await loginAsAdmin();

    await request(app)
      .post("/api/contacts")
      .set("Authorization", `Bearer ${token}`)
      .send({
        companyId: "missing-company",
        firstName: "No",
        lastName: "Company"
      })
      .expect(404);
  });
});
