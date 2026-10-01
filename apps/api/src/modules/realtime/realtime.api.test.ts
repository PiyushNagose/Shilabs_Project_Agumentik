import http from "node:http";
import request from "supertest";
import WebSocket from "ws";
import { UserRole, UserStatus } from "@prisma/client";
import type { AuthResponse } from "@shilabs/shared-types";
import { createApp } from "../../app.js";
import { prisma } from "../../shared/prisma.js";
import { hashPassword } from "../auth/auth.service.js";
import { installRealtimeWebSocketServer, publishRealtimeEvent } from "./realtime.service.js";

const adminEmail = "realtime-admin@example.local";
const repEmail = "realtime-rep@example.local";

function waitForSocketMessage(socket: WebSocket): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timed out waiting for websocket message")), 5000);
    socket.once("message", (data) => {
      clearTimeout(timer);
      const message = typeof data === "string" ? data : Buffer.isBuffer(data) ? data.toString("utf8") : "";
      resolve(JSON.parse(message) as unknown);
    });
  });
}

describe("realtime websocket API", () => {
  let server: http.Server;
  let baseUrl: string;

  beforeEach(async () => {
    await prisma.authSession.deleteMany({ where: { user: { email: { in: [adminEmail, repEmail] } } } });
    await prisma.lead.deleteMany({ where: { source: "realtime-test" } });
    await prisma.contact.deleteMany({ where: { source: "realtime-test" } });
    await prisma.company.deleteMany({ where: { name: { startsWith: "Realtime Test" } } });
    await prisma.user.deleteMany({ where: { email: { in: [adminEmail, repEmail] } } });
    await prisma.user.createMany({
      data: [
        {
          email: adminEmail,
          passwordHash: await hashPassword("CorrectHorse123!"),
          firstName: "Realtime",
          lastName: "Admin",
          role: UserRole.ADMIN,
          status: UserStatus.ACTIVE
        },
        {
          email: repEmail,
          passwordHash: await hashPassword("CorrectHorse123!"),
          firstName: "Realtime",
          lastName: "Rep",
          role: UserRole.SALES_REP,
          status: UserStatus.ACTIVE
        }
      ]
    });
    server = http.createServer(createApp());
    installRealtimeWebSocketServer(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Server did not bind to a port");
    baseUrl = `http://127.0.0.1:${String(address.port)}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  afterAll(async () => {
    await prisma.authSession.deleteMany({ where: { user: { email: { in: [adminEmail, repEmail] } } } });
    await prisma.lead.deleteMany({ where: { source: "realtime-test" } });
    await prisma.contact.deleteMany({ where: { source: "realtime-test" } });
    await prisma.company.deleteMany({ where: { name: { startsWith: "Realtime Test" } } });
    await prisma.user.deleteMany({ where: { email: { in: [adminEmail, repEmail] } } });
    await prisma.$disconnect();
  });

  it("authenticates websocket clients and delivers persisted lead updates to authorized users", async () => {
    const login = await request(createApp())
      .post("/api/auth/login")
      .send({ email: adminEmail, password: "CorrectHorse123!" })
      .expect(200);
    const accessToken = (login.body as AuthResponse).accessToken;
    const socket = new WebSocket(`${baseUrl.replace("http:", "ws:")}/realtime?token=${encodeURIComponent(accessToken)}`);
    await waitForSocketMessage(socket);

    const stage = await prisma.pipelineStage.findFirstOrThrow({ where: { key: "NEW" } });
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: adminEmail } });
    const company = await prisma.company.create({ data: { name: "Realtime Test Company" } });
    const contact = await prisma.contact.create({
      data: {
        companyId: company.id,
        firstName: "Realtime",
        lastName: "Lead",
        source: "realtime-test"
      }
    });
    const lead = await prisma.lead.create({
      data: {
        companyId: company.id,
        contactId: contact.id,
        ownerId: admin.id,
        stageId: stage.id,
        source: "realtime-test"
      }
    });

    const messagePromise = waitForSocketMessage(socket);
    await publishRealtimeEvent({ entityType: "lead", action: "lead-updated", leadId: lead.id });
    await expect(messagePromise).resolves.toMatchObject({
      type: "realtime:update",
      entityType: "lead",
      action: "lead-updated",
      leadId: lead.id
    });
    socket.close();
  });
});

