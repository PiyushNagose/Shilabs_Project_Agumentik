import { randomUUID } from "node:crypto";
import request from "supertest";
import { UserRole, UserStatus } from "@prisma/client";
import type {
  AuthResponse,
  IntegrationConnectionDto,
  IntegrationDashboardDto
} from "@shilabs/shared-types";
import { createApp } from "../../app.js";
import { prisma } from "../../shared/prisma.js";
import { hashPassword } from "../auth/auth.service.js";

const app = createApp();
const marker = `phase9-${randomUUID()}`;

async function identity(label: string, role: UserRole = UserRole.ADMIN) {
  const user = await prisma.user.create({
    data: {
      email: `${marker}-${label}@example.local`,
      passwordHash: await hashPassword("CorrectHorse123!"),
      firstName: label,
      lastName: "Phase9",
      role,
      status: UserStatus.ACTIVE
    }
  });
  const workspace = await prisma.workspace.create({
    data: { name: `${marker}-${label}`, slug: `${marker}-${label}` }
  });
  await prisma.workspaceMember.create({
    data: {
      workspaceId: workspace.id,
      userId: user.id,
      role:
        role === UserRole.SALES_REP
          ? "SALES_REP"
          : role === UserRole.SALES_MANAGER
            ? "SALES_MANAGER"
            : "ADMIN",
      status: "ACTIVE"
    }
  });
  const login = await request(app)
    .post("/api/auth/login")
    .send({ email: user.email, password: "CorrectHorse123!" })
    .expect(200);
  return { user, workspace, token: (login.body as AuthResponse).accessToken };
}
function api(method: "get" | "post" | "delete", path: string, token: string, workspaceId: string) {
  const client = request(app);
  return client[method](path)
    .set("Authorization", `Bearer ${token}`)
    .set("x-workspace-id", workspaceId);
}

describe("Phase 9 integration management API", () => {
  afterAll(async () => {
    const workspaces = await prisma.workspace.findMany({
      where: { slug: { startsWith: marker } },
      select: { id: true }
    });
    const workspaceIds = workspaces.map(({ id }) => id);
    const users = await prisma.user.findMany({
      where: { email: { startsWith: marker } },
      select: { id: true }
    });
    const userIds = users.map(({ id }) => id);
    await prisma.auditEvent.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    await prisma.integrationAccount.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    await prisma.authSession.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.workspaceMember.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    await prisma.workspace.deleteMany({ where: { id: { in: workspaceIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  it("enforces manager RBAC and workspace isolation without exposing credentials", async () => {
    const admin = await identity("admin");
    const other = await identity("other");
    const rep = await identity("rep", UserRole.SALES_REP);
    await api("get", "/api/integrations", rep.token, rep.workspace.id).expect(403);

    const connected = (
      await api("post", "/api/integrations/catalog/openai/connect", admin.token, admin.workspace.id)
        .send({})
        .expect(200)
    ).body as IntegrationConnectionDto;
    expect(connected.provider).toBe("OPENAI");
    expect(["CONNECTED", "NEEDS_ATTENTION"]).toContain(connected.status);
    expect(JSON.stringify(connected)).not.toMatch(/secret|apiKey|credential/i);

    const persisted = await prisma.integrationAccount.findUniqueOrThrow({
      where: { id: connected.id }
    });
    expect(persisted.workspaceId).toBe(admin.workspace.id);
    await api(
      "post",
      `/api/integrations/connections/${connected.id}/reconnect`,
      other.token,
      other.workspace.id
    ).expect(404);

    const dashboard = (
      await api("get", "/api/integrations", admin.token, admin.workspace.id).expect(200)
    ).body as IntegrationDashboardDto;
    expect(dashboard.connections.some((item) => item.id === connected.id)).toBe(true);
    expect(dashboard.catalog.some((item) => item.key === "zoho-bigin")).toBe(true);
  });

  it("persists disable and disconnect lifecycle with audit evidence", async () => {
    const manager = await identity("manager", UserRole.SALES_MANAGER);
    const connected = (
      await api(
        "post",
        "/api/integrations/catalog/gemini/connect",
        manager.token,
        manager.workspace.id
      )
        .send({})
        .expect(200)
    ).body as IntegrationConnectionDto;
    const disabled = (
      await api(
        "post",
        `/api/integrations/connections/${connected.id}/disable`,
        manager.token,
        manager.workspace.id
      ).expect(200)
    ).body as IntegrationConnectionDto;
    expect(disabled.status).toBe("DISABLED");
    await api(
      "delete",
      `/api/integrations/connections/${connected.id}`,
      manager.token,
      manager.workspace.id
    ).expect(204);
    expect(await prisma.integrationAccount.findUnique({ where: { id: connected.id } })).toBeNull();
    const actions = await prisma.auditEvent.findMany({
      where: { workspaceId: manager.workspace.id },
      select: { action: true }
    });
    expect(actions.map(({ action }) => action)).toEqual(
      expect.arrayContaining([
        "integration-connected",
        "integration-disabled",
        "integration-disconnected"
      ])
    );
  });
});
