import request from "supertest";
import { UserRole, UserStatus, WorkspaceMemberStatus, WorkspaceRole } from "@prisma/client";
import type { AuthResponse, PublicUser } from "@shilabs/shared-types";
import { createApp } from "../../app.js";
import { prisma } from "../../shared/prisma.js";
import { hashPassword } from "../auth/auth.service.js";

const app = createApp();
const adminEmail = "users-api-admin@example.local";
const managerEmail = "users-api-manager@example.local";
const repEmail = "users-api-rep@example.local";
const createdEmail = "users-api-created@example.local";
const secondaryWorkspaceSlug = "users-api-secondary";

async function loginAs(email: string): Promise<string> {
  const response = await request(app)
    .post("/api/auth/login")
    .send({ email, password: "CorrectHorse123!" })
    .expect(200);

  const body = response.body as unknown as AuthResponse;
  return body.accessToken;
}

describe("users API RBAC", () => {
  beforeEach(async () => {
    await prisma.workspace.deleteMany({ where: { slug: secondaryWorkspaceSlug } });
    await prisma.authSession.deleteMany({
      where: {
        user: {
          email: {
            in: [adminEmail, managerEmail, repEmail, createdEmail]
          }
        }
      }
    });
    await prisma.user.deleteMany({
      where: {
        email: {
          in: [adminEmail, managerEmail, repEmail, createdEmail]
        }
      }
    });

    const passwordHash = await hashPassword("CorrectHorse123!");
    await prisma.user.createMany({
      data: [
        {
          email: adminEmail,
          passwordHash,
          firstName: "Admin",
          lastName: "User",
          role: UserRole.ADMIN,
          status: UserStatus.ACTIVE
        },
        {
          email: managerEmail,
          passwordHash,
          firstName: "Manager",
          lastName: "User",
          role: UserRole.SALES_MANAGER,
          status: UserStatus.ACTIVE
        },
        {
          email: repEmail,
          passwordHash,
          firstName: "Rep",
          lastName: "User",
          role: UserRole.SALES_REP,
          status: UserStatus.ACTIVE
        }
      ]
    });
    const workspace = await prisma.workspace.upsert({
      where: { slug: "default" },
      create: { slug: "default", name: "Default Workspace" },
      update: {}
    });
    const users = await prisma.user.findMany({
      where: { email: { in: [adminEmail, managerEmail, repEmail] } },
      select: { id: true, role: true }
    });
    await prisma.workspaceMember.createMany({
      data: users.map((user) => ({
        workspaceId: workspace.id,
        userId: user.id,
        role: user.role === UserRole.ADMIN ? WorkspaceRole.ADMIN : user.role,
        status: WorkspaceMemberStatus.ACTIVE
      })),
      skipDuplicates: true
    });
  });

  afterAll(async () => {
    await prisma.workspace.deleteMany({ where: { slug: secondaryWorkspaceSlug } });
    await prisma.authSession.deleteMany({
      where: {
        user: {
          email: {
            in: [adminEmail, managerEmail, repEmail, createdEmail]
          }
        }
      }
    });
    await prisma.user.deleteMany({
      where: {
        email: {
          in: [adminEmail, managerEmail, repEmail, createdEmail]
        }
      }
    });
    await prisma.$disconnect();
  });

  it("allows admins to create users", async () => {
    const token = await loginAs(adminEmail);

    const response = await request(app)
      .post("/api/users")
      .set("Authorization", `Bearer ${token}`)
      .send({
        email: createdEmail,
        password: "CorrectHorse123!",
        firstName: "Created",
        lastName: "User",
        role: "SALES_REP"
      })
      .expect(201);

    const body = response.body as unknown as PublicUser & { passwordHash?: string };
    expect(body.email).toBe(createdEmail);
    expect(body.passwordHash).toBeUndefined();
    const created = await prisma.user.findUniqueOrThrow({ where: { email: createdEmail } });
    expect(
      await prisma.workspaceMember.findFirst({ where: { userId: created.id, status: "ACTIVE" } })
    ).not.toBeNull();
  });

  it("prevents administrators from assigning or modifying workspace owners", async () => {
    const token = await loginAs(adminEmail);
    await request(app)
      .post("/api/users")
      .set("Authorization", `Bearer ${token}`)
      .send({
        email: createdEmail,
        password: "CorrectHorse123!",
        firstName: "Created",
        lastName: "Owner",
        role: "OWNER"
      })
      .expect(403);

    const workspace = await prisma.workspace.findUniqueOrThrow({ where: { slug: "default" } });
    const rep = await prisma.user.findUniqueOrThrow({ where: { email: repEmail } });
    await prisma.workspaceMember.update({
      where: { workspaceId_userId: { workspaceId: workspace.id, userId: rep.id } },
      data: { role: WorkspaceRole.OWNER }
    });
    await request(app)
      .patch(`/api/users/${rep.id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ role: "SALES_REP" })
      .expect(403);
    await request(app)
      .patch(`/api/users/${rep.id}/status`)
      .set("Authorization", `Bearer ${token}`)
      .send({ status: "INACTIVE" })
      .expect(403);
  });

  it("allows managers to list users", async () => {
    const token = await loginAs(managerEmail);

    const response = await request(app)
      .get("/api/users")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    const body = response.body as unknown as PublicUser[];

    expect(body.length).toBeGreaterThanOrEqual(3);
  });

  it("forbids sales reps from listing users", async () => {
    const token = await loginAs(repEmail);

    await request(app).get("/api/users").set("Authorization", `Bearer ${token}`).expect(403);
  });

  it("allows sales reps to read only their own user record", async () => {
    const token = await loginAs(repEmail);
    const rep = await prisma.user.findUniqueOrThrow({ where: { email: repEmail } });
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: adminEmail } });

    await request(app)
      .get(`/api/users/${rep.id}`)
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    await request(app)
      .get(`/api/users/${admin.id}`)
      .set("Authorization", `Bearer ${token}`)
      .expect(403);
  });

  it("allows a user to update their own profile without changing their role", async () => {
    const token = await loginAs(repEmail);
    const response = await request(app)
      .patch("/api/users/me/profile")
      .set("Authorization", `Bearer ${token}`)
      .send({ firstName: "Updated", lastName: "Rep" })
      .expect(200);
    const body = response.body as unknown as PublicUser;
    expect(body.firstName).toBe("Updated");
    expect(body.role).toBe("SALES_REP");
  });

  it("prevents administrators from removing their own administrator access", async () => {
    const token = await loginAs(adminEmail);
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: adminEmail } });
    await request(app)
      .patch(`/api/users/${admin.id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ role: "SALES_REP" })
      .expect(409);
  });

  it("updates the selected workspace role without changing the global user or another membership", async () => {
    const token = await loginAs(adminEmail);
    const workspace = await prisma.workspace.findUniqueOrThrow({ where: { slug: "default" } });
    const secondaryWorkspace = await prisma.workspace.create({
      data: { slug: secondaryWorkspaceSlug, name: "Users API Secondary" }
    });
    const rep = await prisma.user.findUniqueOrThrow({ where: { email: repEmail } });
    await prisma.workspaceMember.create({
      data: {
        workspaceId: secondaryWorkspace.id,
        userId: rep.id,
        role: WorkspaceRole.SALES_MANAGER,
        status: WorkspaceMemberStatus.ACTIVE
      }
    });

    const response = await request(app)
      .patch(`/api/users/${rep.id}`)
      .set("Authorization", `Bearer ${token}`)
      .set("x-workspace-id", workspace.id)
      .send({ role: "OPERATIONS" })
      .expect(200);

    expect((response.body as PublicUser).workspaceRole).toBe("OPERATIONS");
    expect((await prisma.user.findUniqueOrThrow({ where: { id: rep.id } })).role).toBe(
      UserRole.SALES_REP
    );
    expect(
      (
        await prisma.workspaceMember.findUniqueOrThrow({
          where: { workspaceId_userId: { workspaceId: workspace.id, userId: rep.id } }
        })
      ).role
    ).toBe(WorkspaceRole.OPERATIONS);
    expect(
      (
        await prisma.workspaceMember.findUniqueOrThrow({
          where: { workspaceId_userId: { workspaceId: secondaryWorkspace.id, userId: rep.id } }
        })
      ).role
    ).toBe(WorkspaceRole.SALES_MANAGER);
  });

  it("suspends only the selected workspace membership and keeps it visible to administrators", async () => {
    const token = await loginAs(adminEmail);
    const workspace = await prisma.workspace.findUniqueOrThrow({ where: { slug: "default" } });
    const secondaryWorkspace = await prisma.workspace.create({
      data: { slug: secondaryWorkspaceSlug, name: "Users API Secondary" }
    });
    const rep = await prisma.user.findUniqueOrThrow({ where: { email: repEmail } });
    await prisma.workspaceMember.create({
      data: {
        workspaceId: secondaryWorkspace.id,
        userId: rep.id,
        role: WorkspaceRole.SALES_REP,
        status: WorkspaceMemberStatus.ACTIVE
      }
    });

    const response = await request(app)
      .patch(`/api/users/${rep.id}/status`)
      .set("Authorization", `Bearer ${token}`)
      .set("x-workspace-id", workspace.id)
      .send({ status: "INACTIVE" })
      .expect(200);

    expect((response.body as PublicUser).status).toBe("INACTIVE");
    expect((await prisma.user.findUniqueOrThrow({ where: { id: rep.id } })).status).toBe(
      UserStatus.ACTIVE
    );
    expect(
      (
        await prisma.workspaceMember.findUniqueOrThrow({
          where: { workspaceId_userId: { workspaceId: workspace.id, userId: rep.id } }
        })
      ).status
    ).toBe(WorkspaceMemberStatus.SUSPENDED);
    expect(
      (
        await prisma.workspaceMember.findUniqueOrThrow({
          where: { workspaceId_userId: { workspaceId: secondaryWorkspace.id, userId: rep.id } }
        })
      ).status
    ).toBe(WorkspaceMemberStatus.ACTIVE);

    const listResponse = await request(app)
      .get("/api/users")
      .set("Authorization", `Bearer ${token}`)
      .set("x-workspace-id", workspace.id)
      .expect(200);
    expect((listResponse.body as PublicUser[]).find((member) => member.id === rep.id)?.status).toBe(
      "INACTIVE"
    );
  });

  it("does not list users outside the active workspace", async () => {
    const token = await loginAs(managerEmail);
    const outsideWorkspace = await prisma.workspace.create({
      data: { slug: "users-isolation", name: "Isolated Workspace" }
    });
    const isolatedUser = await prisma.user.create({
      data: {
        email: "users-api-isolated@example.local",
        passwordHash: await hashPassword("CorrectHorse123!"),
        firstName: "Isolated",
        lastName: "Member",
        role: UserRole.SALES_REP
      }
    });
    await prisma.workspaceMember.create({
      data: {
        workspaceId: outsideWorkspace.id,
        userId: isolatedUser.id,
        role: WorkspaceRole.SALES_REP
      }
    });
    const response = await request(app)
      .get("/api/users")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    expect((response.body as PublicUser[]).some((user) => user.id === isolatedUser.id)).toBe(false);
    await request(app)
      .get(`/api/users/${isolatedUser.id}`)
      .set("Authorization", `Bearer ${token}`)
      .expect(404);
    await prisma.user.delete({ where: { id: isolatedUser.id } });
    await prisma.workspace.delete({ where: { id: outsideWorkspace.id } });
  });
});
