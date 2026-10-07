import request from "supertest";
import { UserRole, UserStatus } from "@prisma/client";
import type { AuthResponse, IntegrationHealthDto } from "@shilabs/shared-types";
import { createApp } from "../../../app.js";
import { prisma } from "../../../shared/prisma.js";
import { hashPassword } from "../../auth/auth.service.js";

const app = createApp();
const adminEmail = "r2-zoho-admin@example.local";
const originalZohoEnv = {
  ZOHO_BIGIN_CLIENT_ID: process.env.ZOHO_BIGIN_CLIENT_ID,
  ZOHO_BIGIN_CLIENT_SECRET: process.env.ZOHO_BIGIN_CLIENT_SECRET,
  ZOHO_BIGIN_REFRESH_TOKEN: process.env.ZOHO_BIGIN_REFRESH_TOKEN,
  ZOHO_BIGIN_ACCOUNTS_URL: process.env.ZOHO_BIGIN_ACCOUNTS_URL,
  ZOHO_BIGIN_API_DOMAIN: process.env.ZOHO_BIGIN_API_DOMAIN
};

async function loginAsAdmin(): Promise<string> {
  const response = await request(app)
    .post("/api/auth/login")
    .send({ email: adminEmail, password: "CorrectHorse123!" })
    .expect(200);
  const body = response.body as unknown as AuthResponse;
  return body.accessToken;
}

describe("Zoho Bigin health API", () => {
  beforeEach(async () => {
    process.env.ZOHO_BIGIN_CLIENT_ID = "";
    process.env.ZOHO_BIGIN_CLIENT_SECRET = "";
    process.env.ZOHO_BIGIN_REFRESH_TOKEN = "";
    process.env.ZOHO_BIGIN_ACCOUNTS_URL = "https://accounts.zoho.com";
    process.env.ZOHO_BIGIN_API_DOMAIN = "https://www.zohoapis.com";
    await prisma.authSession.deleteMany({ where: { user: { email: adminEmail } } });
    await prisma.user.deleteMany({ where: { email: adminEmail } });
    await prisma.user.create({
      data: {
        email: adminEmail,
        passwordHash: await hashPassword("CorrectHorse123!"),
        firstName: "Zoho",
        lastName: "Admin",
        role: UserRole.ADMIN,
        status: UserStatus.ACTIVE
      }
    });
  });

  afterAll(async () => {
    process.env.ZOHO_BIGIN_CLIENT_ID = originalZohoEnv.ZOHO_BIGIN_CLIENT_ID;
    process.env.ZOHO_BIGIN_CLIENT_SECRET = originalZohoEnv.ZOHO_BIGIN_CLIENT_SECRET;
    process.env.ZOHO_BIGIN_REFRESH_TOKEN = originalZohoEnv.ZOHO_BIGIN_REFRESH_TOKEN;
    process.env.ZOHO_BIGIN_ACCOUNTS_URL = originalZohoEnv.ZOHO_BIGIN_ACCOUNTS_URL;
    process.env.ZOHO_BIGIN_API_DOMAIN = originalZohoEnv.ZOHO_BIGIN_API_DOMAIN;
    await prisma.authSession.deleteMany({ where: { user: { email: adminEmail } } });
    await prisma.user.deleteMany({ where: { email: adminEmail } });
    await prisma.$disconnect();
  });

  it("requires authentication", async () => {
    await request(app).get("/api/integrations/zoho-bigin/health").expect(401);
  });

  it("truthfully reports NOT_CONFIGURED when Zoho credentials are missing", async () => {
    const token = await loginAsAdmin();

    const response = await request(app)
      .get("/api/integrations/zoho-bigin/health")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    const health = response.body as unknown as IntegrationHealthDto;

    expect(health.provider).toBe("ZOHO_BIGIN");
    expect(health.status).toBe("NOT_CONFIGURED");
    expect(health.configured).toBe(false);
    expect(health.missingConfig).toContain("ZOHO_BIGIN_CLIENT_ID");
    expect(health.lastError).not.toContain("client-secret");

    await expect(
      prisma.integrationAccount.findFirst({
        where: { provider: "ZOHO_BIGIN", key: "default" }
      })
    ).resolves.toMatchObject({
      provider: "ZOHO_BIGIN",
      status: "NOT_CONFIGURED",
      secretRef: "env:ZOHO_BIGIN_CLIENT_SECRET"
    });
  });

  it("truthfully reports ERROR when Zoho runtime config is malformed", async () => {
    process.env.ZOHO_BIGIN_ACCOUNTS_URL = "not-a-url";
    const token = await loginAsAdmin();

    const response = await request(app)
      .get("/api/integrations/zoho-bigin/health")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    const health = response.body as unknown as IntegrationHealthDto;

    expect(health.status).toBe("ERROR");
    expect(health.configured).toBe(false);
    expect(health.lastError).toContain("Invalid");
  });

  it("truthfully skips lead/contact sync when Zoho credentials are missing", async () => {
    const token = await loginAsAdmin();

    const response = await request(app)
      .post("/api/integrations/zoho-bigin/sync/leads-contacts")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);

    expect(response.body).toMatchObject({
      provider: "ZOHO_BIGIN",
      status: "NOT_CONFIGURED",
      totalRecords: 0,
      succeededRecords: 0
    });
  });

  it("truthfully skips deal sync when Zoho credentials are missing", async () => {
    const token = await loginAsAdmin();

    const response = await request(app)
      .post("/api/integrations/zoho-bigin/sync/deals")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);

    expect(response.body).toMatchObject({
      provider: "ZOHO_BIGIN",
      status: "NOT_CONFIGURED",
      totalRecords: 0,
      succeededRecords: 0
    });
  });
});
