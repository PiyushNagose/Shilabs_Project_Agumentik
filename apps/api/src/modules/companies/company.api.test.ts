import request from "supertest";
import { UserRole, UserStatus } from "@prisma/client";
import type { AuthResponse, CompanyDto } from "@shilabs/shared-types";
import { createApp } from "../../app.js";
import { prisma } from "../../shared/prisma.js";
import { hashPassword } from "../auth/auth.service.js";

const app = createApp();
const adminEmail = "companies-api-admin@example.local";

async function loginAsAdmin(): Promise<string> {
  const response = await request(app)
    .post("/api/auth/login")
    .send({ email: adminEmail, password: "CorrectHorse123!" })
    .expect(200);
  const body = response.body as unknown as AuthResponse;
  return body.accessToken;
}

describe("companies API", () => {
  beforeEach(async () => {
    await prisma.authSession.deleteMany({ where: { user: { email: adminEmail } } });
    await prisma.company.deleteMany({
      where: {
        OR: [{ normalizedWebsite: "shilabs.example" }, { name: { startsWith: "M3 Company" } }]
      }
    });
    await prisma.user.deleteMany({ where: { email: adminEmail } });
    await prisma.user.create({
      data: {
        email: adminEmail,
        passwordHash: await hashPassword("CorrectHorse123!"),
        firstName: "Company",
        lastName: "Admin",
        role: UserRole.ADMIN,
        status: UserStatus.ACTIVE
      }
    });
  });

  afterAll(async () => {
    await prisma.authSession.deleteMany({ where: { user: { email: adminEmail } } });
    await prisma.company.deleteMany({
      where: {
        OR: [{ normalizedWebsite: "shilabs.example" }, { name: { startsWith: "M3 Company" } }]
      }
    });
    await prisma.user.deleteMany({ where: { email: adminEmail } });
    await prisma.$disconnect();
  });

  it("creates and reads a company with a normalized website", async () => {
    const token = await loginAsAdmin();

    const createResponse = await request(app)
      .post("/api/companies")
      .set("Authorization", `Bearer ${token}`)
      .send({
        name: "M3 Company One",
        website: "https://www.shilabs.example/services",
        industry: "Technology",
        location: "India",
        employeeRange: "11-50",
        notes: "Qualified prospect account"
      })
      .expect(201);
    const company = createResponse.body as unknown as CompanyDto;

    expect(company.normalizedWebsite).toBe("shilabs.example");
    expect(company.name).toBe("M3 Company One");

    const getResponse = await request(app)
      .get(`/api/companies/${company.id}`)
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    const fetchedCompany = getResponse.body as unknown as CompanyDto;

    expect(fetchedCompany.id).toBe(company.id);
  });

  it("rejects duplicate normalized company websites", async () => {
    const token = await loginAsAdmin();

    await request(app)
      .post("/api/companies")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "M3 Company Original", website: "https://shilabs.example" })
      .expect(201);

    await request(app)
      .post("/api/companies")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "M3 Company Duplicate", website: "https://www.shilabs.example/about" })
      .expect(409);
  });

  it("requires authentication", async () => {
    await request(app).get("/api/companies").expect(401);
  });
});
