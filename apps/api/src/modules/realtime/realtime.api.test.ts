import http from "node:http";
import request from "supertest";
import WebSocket from "ws";
import { UserRole, UserStatus, WorkspaceRole } from "@prisma/client";
import type { AuthResponse } from "@shilabs/shared-types";
import { createApp } from "../../app.js";
import { prisma } from "../../shared/prisma.js";
import { hashPassword } from "../auth/auth.service.js";
import { installRealtimeWebSocketServer, publishRealtimeEvent } from "./realtime.service.js";

const adminEmail = "realtime-admin@example.local";
const repEmail = "realtime-rep@example.local";
const workspaceSlugs = ["realtime-a", "realtime-b"];

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

function expectNoSocketMessage(socket: WebSocket, waitMs = 250): Promise<void> {
  return new Promise((resolve, reject) => {
    const onMessage = (): void => {
      clearTimeout(timer);
      reject(new Error("Unexpected websocket message"));
    };
    const timer = setTimeout(() => {
      socket.off("message", onMessage);
      resolve();
    }, waitMs);
    socket.once("message", onMessage);
  });
}

describe("realtime websocket API", () => {
  let server: http.Server;
  let baseUrl: string;
  let stopRealtime: (() => Promise<void>) | undefined;

  beforeEach(async () => {
    await prisma.authSession.deleteMany({ where: { user: { email: { in: [adminEmail, repEmail] } } } });
    await prisma.lead.deleteMany({ where: { source: "realtime-test" } });
    await prisma.contact.deleteMany({ where: { source: "realtime-test" } });
    await prisma.company.deleteMany({ where: { name: { startsWith: "Realtime Test" } } });
    await prisma.user.deleteMany({ where: { email: { in: [adminEmail, repEmail] } } });
    await prisma.workspace.deleteMany({ where: { slug: { in: workspaceSlugs } } });
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
    const [admin, rep] = await Promise.all([
      prisma.user.findUniqueOrThrow({ where: { email: adminEmail } }),
      prisma.user.findUniqueOrThrow({ where: { email: repEmail } })
    ]);
    const [workspaceA, workspaceB] = await Promise.all([
      prisma.workspace.create({ data: { name: "Realtime A", slug: workspaceSlugs[0] ?? "realtime-a" } }),
      prisma.workspace.create({ data: { name: "Realtime B", slug: workspaceSlugs[1] ?? "realtime-b" } })
    ]);
    await prisma.workspaceMember.createMany({
      data: [
        { workspaceId: workspaceA.id, userId: admin.id, role: WorkspaceRole.ADMIN },
        { workspaceId: workspaceB.id, userId: rep.id, role: WorkspaceRole.SALES_REP }
      ]
    });
    server = http.createServer(createApp());
    stopRealtime = installRealtimeWebSocketServer(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Server did not bind to a port");
    baseUrl = `http://127.0.0.1:${String(address.port)}`;
  });

  afterEach(async () => {
    await stopRealtime?.();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  afterAll(async () => {
    await prisma.authSession.deleteMany({ where: { user: { email: { in: [adminEmail, repEmail] } } } });
    await prisma.lead.deleteMany({ where: { source: "realtime-test" } });
    await prisma.contact.deleteMany({ where: { source: "realtime-test" } });
    await prisma.company.deleteMany({ where: { name: { startsWith: "Realtime Test" } } });
    await prisma.user.deleteMany({ where: { email: { in: [adminEmail, repEmail] } } });
    await prisma.workspace.deleteMany({ where: { slug: { in: workspaceSlugs } } });
    await prisma.$disconnect();
  });

  it("authenticates websocket clients and delivers persisted lead updates to authorized users", async () => {
    const login = await request(createApp())
      .post("/api/auth/login")
      .send({ email: adminEmail, password: "CorrectHorse123!" })
      .expect(200);
    const accessToken = (login.body as AuthResponse).accessToken;
    const workspaceA = await prisma.workspace.findUniqueOrThrow({ where: { slug: workspaceSlugs[0] } });
    const socket = new WebSocket(`${baseUrl.replace("http:", "ws:")}/realtime?token=${encodeURIComponent(accessToken)}&workspaceId=${workspaceA.id}`);
    await waitForSocketMessage(socket);

    const stage = await prisma.pipelineStage.upsert({
      where: { key: "REALTIME_TEST_NEW" },
      create: { workspaceId: workspaceA.id, key: "REALTIME_TEST_NEW", label: "New", order: 9901, probability: 0 },
      update: { workspaceId: workspaceA.id }
    });
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: adminEmail } });
    const company = await prisma.company.create({
      data: { workspaceId: workspaceA.id, name: "Realtime Test Company" }
    });
    const contact = await prisma.contact.create({
      data: {
        workspaceId: workspaceA.id,
        companyId: company.id,
        firstName: "Realtime",
        lastName: "Lead",
        source: "realtime-test"
      }
    });
    const lead = await prisma.lead.create({
      data: {
        workspaceId: workspaceA.id,
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

  it("does not deliver a lead invalidation to a client in another workspace", async () => {
    const [adminLogin, repLogin] = await Promise.all([
      request(createApp()).post("/api/auth/login").send({ email: adminEmail, password: "CorrectHorse123!" }),
      request(createApp()).post("/api/auth/login").send({ email: repEmail, password: "CorrectHorse123!" })
    ]);
    const [workspaceA, workspaceB] = await Promise.all(
      workspaceSlugs.map((slug) => prisma.workspace.findUniqueOrThrow({ where: { slug } }))
    );
    if (!workspaceA || !workspaceB) throw new Error("Realtime test workspaces are missing");
    const adminSocket = new WebSocket(
      `${baseUrl.replace("http:", "ws:")}/realtime?token=${encodeURIComponent((adminLogin.body as AuthResponse).accessToken)}&workspaceId=${workspaceA.id}`
    );
    const repSocket = new WebSocket(
      `${baseUrl.replace("http:", "ws:")}/realtime?token=${encodeURIComponent((repLogin.body as AuthResponse).accessToken)}&workspaceId=${workspaceB.id}`
    );
    await Promise.all([waitForSocketMessage(adminSocket), waitForSocketMessage(repSocket)]);

    const [stage, admin] = await Promise.all([
      prisma.pipelineStage.upsert({
        where: { key: "REALTIME_TEST_NEW" },
        create: { workspaceId: workspaceA.id, key: "REALTIME_TEST_NEW", label: "New", order: 9901, probability: 0 },
        update: { workspaceId: workspaceA.id }
      }),
      prisma.user.findUniqueOrThrow({ where: { email: adminEmail } })
    ]);
    const company = await prisma.company.create({
      data: { workspaceId: workspaceA.id, name: "Realtime Test Isolated Company" }
    });
    const contact = await prisma.contact.create({
      data: {
        workspaceId: workspaceA.id,
        companyId: company.id,
        firstName: "Isolated",
        lastName: "Lead",
        source: "realtime-test"
      }
    });
    const lead = await prisma.lead.create({
      data: {
        workspaceId: workspaceA.id,
        companyId: company.id,
        contactId: contact.id,
        ownerId: admin.id,
        stageId: stage.id,
        source: "realtime-test"
      }
    });

    const adminMessage = waitForSocketMessage(adminSocket);
    const repSilence = expectNoSocketMessage(repSocket);
    await publishRealtimeEvent({ entityType: "lead", action: "lead-updated", leadId: lead.id });
    await expect(adminMessage).resolves.toMatchObject({ leadId: lead.id });
    await expect(repSilence).resolves.toBeUndefined();
    adminSocket.close();
    repSocket.close();
  });
});
