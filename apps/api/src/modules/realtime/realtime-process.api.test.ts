import { fork, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import request from "supertest";
import WebSocket, { type RawData } from "ws";
import { Redis } from "ioredis";
import { describe, expect, it } from "vitest";
import type { AuthResponse } from "@shilabs/shared-types";
import { prisma } from "../../shared/prisma.js";
import { hashPassword } from "../auth/auth.service.js";

interface ApiProcess {
  child: ChildProcess;
  ready: Promise<{ pid: number; baseUrl: string }>;
  stop: () => Promise<void>;
}

function startApi(channel: string): ApiProcess {
  const child = fork(fileURLToPath(new URL("./realtime-process.fixture.ts", import.meta.url)), [], {
    execArgv: ["--import", "tsx"],
    env: {
      ...process.env,
      REALTIME_REDIS_URL: process.env.REDIS_URL,
      REALTIME_REDIS_CHANNEL: channel
    },
    stdio: ["ignore", "pipe", "pipe", "ipc"]
  });
  let diagnostics = "";
  child.stdout?.on("data", (chunk: Buffer) => {
    diagnostics = (diagnostics + chunk.toString("utf8")).slice(-4000);
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    diagnostics = (diagnostics + chunk.toString("utf8")).slice(-4000);
  });
  const ready = new Promise<{ pid: number; baseUrl: string }>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`API child startup timed out: ${diagnostics}`)),
      30000
    );
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`API child exited (${String(code)}): ${diagnostics}`));
    });
    child.on("message", (message: unknown) => {
      if (
        message &&
        typeof message === "object" &&
        "type" in message &&
        message.type === "ready" &&
        "pid" in message &&
        typeof message.pid === "number" &&
        "baseUrl" in message &&
        typeof message.baseUrl === "string"
      ) {
        clearTimeout(timer);
        resolve({ pid: message.pid, baseUrl: message.baseUrl });
      }
    });
  });
  return {
    child,
    ready,
    stop: () =>
      new Promise<void>((resolve) => {
        if (child.exitCode !== null || child.signalCode !== null) {
          resolve();
          return;
        }
        const timer = setTimeout(() => child.kill("SIGKILL"), 5000);
        child.once("exit", () => {
          clearTimeout(timer);
          resolve();
        });
        if (child.connected) child.send({ type: "stop" });
        else child.kill();
      })
  };
}

function openBrowser(baseUrl: string, token: string, workspaceId: string) {
  const socket = new WebSocket(
    `${baseUrl.replace("http:", "ws:")}/realtime?workspaceId=${workspaceId}`,
    ["shilabs.realtime.v1", `bearer.${token}`]
  );
  const updates: unknown[] = [];
  const ready = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Websocket handshake timed out")), 10000);
    socket.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    socket.on("message", (data: RawData) => {
      const buffer = Array.isArray(data)
        ? Buffer.concat(data)
        : Buffer.isBuffer(data)
          ? data
          : Buffer.from(data);
      const message: unknown = JSON.parse(buffer.toString("utf8"));
      if (!message || typeof message !== "object" || !("type" in message)) return;
      if (message.type === "realtime:connected") {
        clearTimeout(timer);
        resolve();
      }
      if (message.type === "realtime:update") updates.push(message);
    });
  });
  return { socket, updates, ready };
}

describe("realtime websocket across two API processes", () => {
  it("relays an authenticated lead mutation once to socket B, without workspace leaks or publisher echo", async () => {
    const databaseUrl = new URL(process.env.DATABASE_URL ?? "");
    expect(process.env.NODE_ENV).toBe("test");
    expect(process.env.DATABASE_URL).toBe(process.env.TEST_DATABASE_URL);
    expect(databaseUrl.hostname).toMatch(/^(localhost|127\.0\.0\.1|\[::1\])$/);
    expect(databaseUrl.searchParams.get("schema")).toMatch(/^codex_test_[A-Za-z0-9_]+$/);
    if (!process.env.REDIS_URL)
      throw new Error("Local Redis is required; this regression must not skip");
    const redisUrl = new URL(process.env.REDIS_URL);
    expect(redisUrl.hostname).toMatch(/^(localhost|127\.0\.0\.1|\[::1\])$/);

    const suffix = randomUUID();
    const channel = `shilabs:test:realtime:process:${suffix}`;
    const redis = new Redis(process.env.REDIS_URL, {
      lazyConnect: true,
      connectTimeout: 3000,
      maxRetriesPerRequest: 1
    });
    const processes: ApiProcess[] = [];
    const browsers: ReturnType<typeof openBrowser>[] = [];
    const workspaceIds: string[] = [];
    const userIds: string[] = [];
    try {
      await redis.connect();
      const passwordHash = await hashPassword("CorrectHorse123!");
      const admin = await prisma.user.create({
        data: {
          email: `realtime-process-admin-${suffix}@example.local`,
          passwordHash,
          firstName: "Realtime",
          lastName: "Admin",
          role: "ADMIN",
          status: "ACTIVE"
        }
      });
      userIds.push(admin.id);
      const outsider = await prisma.user.create({
        data: {
          email: `realtime-process-outsider-${suffix}@example.local`,
          passwordHash,
          firstName: "Realtime",
          lastName: "Outsider",
          role: "ADMIN",
          status: "ACTIVE"
        }
      });
      userIds.push(outsider.id);
      const workspaceA = await prisma.workspace.create({
        data: { name: "Realtime Process A", slug: `realtime-process-a-${suffix}` }
      });
      workspaceIds.push(workspaceA.id);
      const workspaceB = await prisma.workspace.create({
        data: { name: "Realtime Process B", slug: `realtime-process-b-${suffix}` }
      });
      workspaceIds.push(workspaceB.id);
      await prisma.workspaceMember.createMany({
        data: [
          { workspaceId: workspaceA.id, userId: admin.id, role: "ADMIN" },
          { workspaceId: workspaceB.id, userId: outsider.id, role: "ADMIN" }
        ]
      });
      const stage = await prisma.pipelineStage.create({
        data: {
          workspaceId: workspaceA.id,
          key: `REALTIME_PROCESS_${suffix}`,
          label: "New",
          order: 9902,
          probability: 0
        }
      });
      const company = await prisma.company.create({
        data: { workspaceId: workspaceA.id, name: "Realtime Process Company" }
      });
      const contact = await prisma.contact.create({
        data: {
          workspaceId: workspaceA.id,
          companyId: company.id,
          firstName: "Realtime",
          lastName: "Lead",
          source: suffix
        }
      });
      const lead = await prisma.lead.create({
        data: {
          workspaceId: workspaceA.id,
          companyId: company.id,
          contactId: contact.id,
          ownerId: admin.id,
          stageId: stage.id,
          source: suffix
        }
      });

      processes.push(startApi(channel), startApi(channel));
      const [apiA, apiB] = await Promise.all(processes.map((process) => process.ready));
      if (!apiA || !apiB) throw new Error("Both API processes must start");
      expect(apiA.pid).not.toBe(apiB.pid);
      expect(apiA.pid).not.toBe(process.pid);
      expect(apiB.pid).not.toBe(process.pid);
      await expect
        .poll(async () => redis.pubsub("NUMSUB", channel), { timeout: 10000 })
        .toEqual([channel, 2]);
      const adminLogin = await request(apiA.baseUrl)
        .post("/api/auth/login")
        .send({ email: admin.email, password: "CorrectHorse123!" })
        .expect(200);
      const outsiderLogin = await request(apiB.baseUrl)
        .post("/api/auth/login")
        .send({ email: outsider.email, password: "CorrectHorse123!" })
        .expect(200);
      const token = (adminLogin.body as AuthResponse).accessToken;
      const outsiderToken = (outsiderLogin.body as AuthResponse).accessToken;
      const local = openBrowser(apiA.baseUrl, token, workspaceA.id);
      browsers.push(local);
      const remote = openBrowser(apiB.baseUrl, token, workspaceA.id);
      browsers.push(remote);
      const excluded = openBrowser(apiB.baseUrl, outsiderToken, workspaceB.id);
      browsers.push(excluded);
      await Promise.all(browsers.map((browser) => browser.ready));
      for (const browser of browsers) {
        expect(browser.socket.protocol).toBe("shilabs.realtime.v1");
        expect(new URL(browser.socket.url).searchParams.has("token")).toBe(false);
      }

      await request(apiA.baseUrl)
        .patch(`/api/leads/${lead.id}`)
        .set("Authorization", `Bearer ${token}`)
        .set("x-workspace-id", workspaceA.id)
        .send({ nextAction: "Cross-process review verified" })
        .expect(200);
      await expect.poll(() => remote.updates.length, { timeout: 10000 }).toBe(1);
      await expect.poll(() => local.updates.length, { timeout: 10000 }).toBe(1);
      // Keep all listeners active long enough to catch a Redis echo or cross-workspace leak.
      await new Promise<void>((resolve) => setTimeout(resolve, 1000));
      const expected = {
        type: "realtime:update",
        entityType: "lead",
        action: "lead-updated",
        leadId: lead.id,
        workspaceId: workspaceA.id
      };
      expect(local.updates).toHaveLength(1);
      expect(remote.updates).toHaveLength(1);
      expect(local.updates[0]).toMatchObject(expected);
      expect(remote.updates[0]).toEqual(local.updates[0]);
      expect(excluded.updates).toEqual([]);
      expect(
        await prisma.lead.findUniqueOrThrow({
          where: { id: lead.id },
          select: { nextAction: true }
        })
      ).toEqual({ nextAction: "Cross-process review verified" });
    } finally {
      for (const browser of browsers) browser.socket.terminate();
      await Promise.all(processes.map((process) => process.stop()));
      redis.disconnect();
      await prisma.auditEvent.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
      await prisma.lead.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
      await prisma.contact.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
      await prisma.company.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
      await prisma.pipelineStage.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
      await prisma.authSession.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.workspace.deleteMany({ where: { id: { in: workspaceIds } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
      await prisma.$disconnect();
    }
  }, 120000);
});
