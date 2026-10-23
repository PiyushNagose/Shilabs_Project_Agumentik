import { UserRole, UserStatus, WorkspaceRole } from "@prisma/client";
import { prisma } from "../../shared/prisma.js";
import { hashPassword, login, verifyAccessToken, verifyPassword } from "./auth.service.js";

const testEmail = "auth-service-admin@example.local";
const testWorkspaceSlug = "auth-service-workspace";

describe("auth service", () => {
  beforeEach(async () => {
    await prisma.workspace.deleteMany({ where: { slug: testWorkspaceSlug } });
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
    await prisma.workspace.deleteMany({ where: { slug: testWorkspaceSlug } });
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
    const user = await prisma.user.create({
      data: {
        email: testEmail,
        passwordHash: await hashPassword("CorrectHorse123!"),
        firstName: "Auth",
        lastName: "Tester",
        role: UserRole.ADMIN,
        status: UserStatus.ACTIVE
      }
    });
    const workspace = await prisma.workspace.create({
      data: { slug: testWorkspaceSlug, name: "Auth Service Workspace" }
    });
    await prisma.workspaceMember.create({
      data: { workspaceId: workspace.id, userId: user.id, role: WorkspaceRole.ADMIN }
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
