import { UserRole, UserStatus } from "@prisma/client";
import { prisma } from "../../shared/prisma.js";
import { hashPassword, login, verifyAccessToken, verifyPassword } from "./auth.service.js";

const testEmail = "auth-service-admin@example.local";

describe("auth service", () => {
  beforeEach(async () => {
    await prisma.authSession.deleteMany({
      where: {
        user: {
          email: testEmail
        }
      }
    });
    await prisma.user.deleteMany({ where: { email: testEmail } });
  });

  afterAll(async () => {
    await prisma.authSession.deleteMany({
      where: {
        user: {
          email: testEmail
        }
      }
    });
    await prisma.user.deleteMany({ where: { email: testEmail } });
    await prisma.$disconnect();
  });

  it("hashes and verifies passwords without storing raw passwords", async () => {
    const passwordHash = await hashPassword("CorrectHorse123!");

    expect(passwordHash).not.toBe("CorrectHorse123!");
    await expect(verifyPassword("CorrectHorse123!", passwordHash)).resolves.toBe(true);
    await expect(verifyPassword("wrong-password", passwordHash)).resolves.toBe(false);
  });

  it("creates a session-backed access token for an active user", async () => {
    await prisma.user.create({
      data: {
        email: testEmail,
        passwordHash: await hashPassword("CorrectHorse123!"),
        firstName: "Auth",
        lastName: "Tester",
        role: UserRole.ADMIN,
        status: UserStatus.ACTIVE
      }
    });

    const result = await login({
      email: testEmail,
      password: "CorrectHorse123!"
    });
    const verifiedUser = await verifyAccessToken(result.accessToken);

    expect(result.user.email).toBe(testEmail);
    expect(verifiedUser.email).toBe(testEmail);
  });
});
