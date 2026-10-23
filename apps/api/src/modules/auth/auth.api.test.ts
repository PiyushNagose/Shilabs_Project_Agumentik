import request from "supertest";
import { UserRole, UserStatus, WorkspaceMemberStatus, WorkspaceRole } from "@prisma/client";
import type { AuthResponse, PublicUser } from "@shilabs/shared-types";
import { createApp } from "../../app.js";
import { prisma } from "../../shared/prisma.js";
import { hashPassword } from "./auth.service.js";

const app = createApp();
const activeEmail = "auth-api-active@example.local";
const inactiveEmail = "auth-api-inactive@example.local";
const inactiveWorkspaceSlug = "auth-api-inactive-membership";
const activeWorkspaceSlug = "auth-api-active-membership";
const baseWorkspaceSlug = "auth-api-base-membership";

describe("auth API", () => {
  beforeEach(async () => {
    await prisma.workspace.deleteMany({
      where: { slug: { in: [inactiveWorkspaceSlug, activeWorkspaceSlug, baseWorkspaceSlug] } }
    });
    await prisma.authSession.deleteMany({
      where: {
        user: {
          email: {
            in: [activeEmail, inactiveEmail]
          }
        }
      }
    });
    await prisma.user.deleteMany({
      where: {
        email: {
          in: [activeEmail, inactiveEmail]
        }
      }
    });
    await prisma.user.createMany({
      data: [
        {
          email: activeEmail,
          passwordHash: await hashPassword("CorrectHorse123!"),
          firstName: "Active",
          lastName: "User",
          role: UserRole.ADMIN,
          status: UserStatus.ACTIVE
        },
        {
          email: inactiveEmail,
          passwordHash: await hashPassword("CorrectHorse123!"),
          firstName: "Inactive",
          lastName: "User",
          role: UserRole.SALES_REP,
          status: UserStatus.INACTIVE
        }
      ]
    });
    const activeUser = await prisma.user.findUniqueOrThrow({ where: { email: activeEmail } });
    const baseWorkspace = await prisma.workspace.create({
      data: { slug: baseWorkspaceSlug, name: "Auth API Base Workspace" }
    });
    await prisma.workspaceMember.create({
      data: {
        workspaceId: baseWorkspace.id,
        userId: activeUser.id,
        role: WorkspaceRole.ADMIN,
        status: WorkspaceMemberStatus.ACTIVE
      }
    });
  });

  afterAll(async () => {
    await prisma.workspace.deleteMany({
      where: { slug: { in: [inactiveWorkspaceSlug, activeWorkspaceSlug, baseWorkspaceSlug] } }
    });
    await prisma.authSession.deleteMany({
      where: {
        user: {
          email: {
            in: [activeEmail, inactiveEmail]
          }
        }
      }
    });
    await prisma.user.deleteMany({
      where: {
        email: {
          in: [activeEmail, inactiveEmail]
        }
      }
    });
    await prisma.$disconnect();
  });

  it("logs in active users and returns the current user", async () => {
    const loginResponse = await request(app)
      .post("/api/auth/login")
      .send({ email: activeEmail, password: "CorrectHorse123!" })
      .expect(200);

    const loginBody = loginResponse.body as unknown as AuthResponse & {
      user: PublicUser & { passwordHash?: string };
    };
    const accessToken = loginBody.accessToken;
    expect(accessToken).toContain(".");
    expect(loginBody.user.email).toBe(activeEmail);
    expect(loginBody.user.passwordHash).toBeUndefined();

    const meResponse = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${accessToken}`)
      .expect(200);
    const meBody = meResponse.body as unknown as PublicUser;

    expect(meBody.email).toBe(activeEmail);
  });

  it("does not rate-limit successful sign-ins from a shared client address", async () => {
    for (let attempt = 0; attempt < 11; attempt += 1) {
      await request(app)
        .post("/api/auth/login")
        .send({ email: activeEmail, password: "CorrectHorse123!" })
        .expect(200);
    }
  });

  it("rejects invalid passwords", async () => {
    await request(app)
      .post("/api/auth/login")
      .send({ email: activeEmail, password: "wrong-password" })
      .expect(401);
  });

  it("rejects disabled users", async () => {
    await request(app)
      .post("/api/auth/login")
      .send({ email: inactiveEmail, password: "CorrectHorse123!" })
      .expect(403);
  });

  it("rejects an inactive selected membership while preserving access to another workspace", async () => {
    const user = await prisma.user.findUniqueOrThrow({ where: { email: activeEmail } });
    const inactiveWorkspace = await prisma.workspace.create({
      data: { slug: inactiveWorkspaceSlug, name: "Inactive Membership Workspace" }
    });
    const activeWorkspace = await prisma.workspace.create({
      data: { slug: activeWorkspaceSlug, name: "Active Membership Workspace" }
    });
    await prisma.workspaceMember.createMany({
      data: [
        {
          workspaceId: inactiveWorkspace.id,
          userId: user.id,
          role: WorkspaceRole.ADMIN,
          status: WorkspaceMemberStatus.SUSPENDED
        },
        {
          workspaceId: activeWorkspace.id,
          userId: user.id,
          role: WorkspaceRole.SALES_REP,
          status: WorkspaceMemberStatus.ACTIVE
        }
      ]
    });

    const loginResponse = await request(app)
      .post("/api/auth/login")
      .send({ email: activeEmail, password: "CorrectHorse123!" })
      .expect(200);
    const accessToken = (loginResponse.body as AuthResponse).accessToken;

    await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${accessToken}`)
      .set("x-workspace-id", inactiveWorkspace.id)
      .expect(403);

    const activeResponse = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${accessToken}`)
      .set("x-workspace-id", activeWorkspace.id)
      .expect(200);
    expect((activeResponse.body as PublicUser).workspaceRole).toBe("SALES_REP");
  });

  it("requires authentication for protected routes", async () => {
    await request(app).get("/api/auth/me").expect(401);
  });

  it("invalidates sessions on logout", async () => {
    const loginResponse = await request(app)
      .post("/api/auth/login")
      .send({ email: activeEmail, password: "CorrectHorse123!" })
      .expect(200);
    const loginBody = loginResponse.body as unknown as AuthResponse;
    const accessToken = loginBody.accessToken;

    await request(app)
      .post("/api/auth/logout")
      .set("Authorization", `Bearer ${accessToken}`)
      .expect(204);
    await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${accessToken}`)
      .expect(401);
  });
});
