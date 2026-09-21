import request from "supertest";
import { beforeEach, afterAll, describe, expect, it } from "vitest";
import { UserRole, UserStatus } from "@prisma/client";
import type {
  AuthResponse,
  EmailSuppressionDto,
  IntegrationHealthDto
} from "@shilabs/shared-types";
import { createApp } from "../../app.js";
import { prisma } from "../../shared/prisma.js";
import { hashPassword } from "../auth/auth.service.js";

const app = createApp();
const adminEmail = "r5-email-api-admin@example.local";
const originalSesEnv = {
  EMAIL_PROVIDER: process.env.EMAIL_PROVIDER,
  ALLOW_EXTERNAL_EMAIL_IN_NON_PRODUCTION: process.env.ALLOW_EXTERNAL_EMAIL_IN_NON_PRODUCTION,
  AWS_SES_REGION: process.env.AWS_SES_REGION,
  AWS_SES_FROM_EMAIL: process.env.AWS_SES_FROM_EMAIL,
  AWS_SES_ACCESS_KEY_ID: process.env.AWS_SES_ACCESS_KEY_ID,
  AWS_SES_SECRET_ACCESS_KEY: process.env.AWS_SES_SECRET_ACCESS_KEY,
  AWS_SES_WEBHOOK_SECRET: process.env.AWS_SES_WEBHOOK_SECRET
};

async function login(): Promise<string> {
  const response = await request(app)
    .post("/api/auth/login")
    .send({ email: adminEmail, password: "CorrectHorse123!" })
    .expect(200);
  return (response.body as unknown as AuthResponse).accessToken;
}

describe("AWS SES email API", () => {
  beforeEach(async () => {
    process.env.EMAIL_PROVIDER = "AWS_SES";
    process.env.ALLOW_EXTERNAL_EMAIL_IN_NON_PRODUCTION = "false";
    process.env.AWS_SES_REGION = "";
    process.env.AWS_SES_FROM_EMAIL = "";
    process.env.AWS_SES_ACCESS_KEY_ID = "";
    process.env.AWS_SES_SECRET_ACCESS_KEY = "";
    process.env.AWS_SES_WEBHOOK_SECRET = "";
    await prisma.emailSuppression.deleteMany({
      where: { normalizedEmail: "r7-api-suppressed@example.com" }
    });
    await prisma.authSession.deleteMany({ where: { user: { email: adminEmail } } });
    await prisma.user.deleteMany({ where: { email: adminEmail } });
    await prisma.user.create({
      data: {
        email: adminEmail,
        passwordHash: await hashPassword("CorrectHorse123!"),
        firstName: "SES",
        lastName: "Admin",
        role: UserRole.ADMIN,
        status: UserStatus.ACTIVE
      }
    });
  });

  afterAll(async () => {
    process.env.EMAIL_PROVIDER = originalSesEnv.EMAIL_PROVIDER;
    process.env.ALLOW_EXTERNAL_EMAIL_IN_NON_PRODUCTION =
      originalSesEnv.ALLOW_EXTERNAL_EMAIL_IN_NON_PRODUCTION;
    process.env.AWS_SES_REGION = originalSesEnv.AWS_SES_REGION;
    process.env.AWS_SES_FROM_EMAIL = originalSesEnv.AWS_SES_FROM_EMAIL;
    process.env.AWS_SES_ACCESS_KEY_ID = originalSesEnv.AWS_SES_ACCESS_KEY_ID;
    process.env.AWS_SES_SECRET_ACCESS_KEY = originalSesEnv.AWS_SES_SECRET_ACCESS_KEY;
    process.env.AWS_SES_WEBHOOK_SECRET = originalSesEnv.AWS_SES_WEBHOOK_SECRET;
    await prisma.emailSuppression.deleteMany({
      where: { normalizedEmail: "r7-api-suppressed@example.com" }
    });
    await prisma.authSession.deleteMany({ where: { user: { email: adminEmail } } });
    await prisma.user.deleteMany({ where: { email: adminEmail } });
    await prisma.$disconnect();
  });

  it("requires authentication for SES health", async () => {
    await request(app).get("/api/email/health").expect(401);
  });

  it("truthfully reports NOT_CONFIGURED for missing SES credentials", async () => {
    const token = await login();

    const response = await request(app)
      .get("/api/email/health")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    const health = response.body as unknown as IntegrationHealthDto;

    expect(health.provider).toBe("AWS_SES");
    expect(health.status).toBe("NOT_CONFIGURED");
    expect(health.configured).toBe(false);
    expect(health.missingConfig).toContain("AWS_SES_REGION");
  });

  it("lets admins create a real suppression record", async () => {
    const token = await login();

    const response = await request(app)
      .post("/api/email/suppressions")
      .set("Authorization", `Bearer ${token}`)
      .send({
        email: "r7-api-suppressed@example.com",
        reason: "MANUAL",
        source: "OPERATOR"
      })
      .expect(200);
    const suppression = response.body as unknown as EmailSuppressionDto;

    expect(suppression.normalizedEmail).toBe("r7-api-suppressed@example.com");
    expect(suppression.reason).toBe("MANUAL");
    await expect(
      prisma.emailSuppression.count({
        where: { normalizedEmail: "r7-api-suppressed@example.com" }
      })
    ).resolves.toBe(1);
  });
});
