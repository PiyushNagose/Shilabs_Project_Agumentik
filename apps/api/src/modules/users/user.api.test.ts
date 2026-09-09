import request from "supertest";
import { UserRole, UserStatus } from "@prisma/client";
import type { AuthResponse, PublicUser } from "@shilabs/shared-types";
import { createApp } from "../../app.js";
import { prisma } from "../../shared/prisma.js";
import { hashPassword } from "../auth/auth.service.js";

const app = createApp();
const adminEmail = "users-api-admin@example.local";
const managerEmail = "users-api-manager@example.local";
const repEmail = "users-api-rep@example.local";
const createdEmail = "users-api-created@example.local";

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
  });

  afterAll(async () => {
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
});
