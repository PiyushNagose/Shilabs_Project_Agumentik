import request from "supertest";
import { UserRole, UserStatus } from "@prisma/client";
import type { AuthResponse, PublicUser } from "@shilabs/shared-types";
import { createApp } from "../../app.js";
import { prisma } from "../../shared/prisma.js";
import { hashPassword } from "./auth.service.js";

const app = createApp();
const activeEmail = "auth-api-active@example.local";
const inactiveEmail = "auth-api-inactive@example.local";

describe("auth API", () => {
  beforeEach(async () => {
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
  });

  afterAll(async () => {
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
