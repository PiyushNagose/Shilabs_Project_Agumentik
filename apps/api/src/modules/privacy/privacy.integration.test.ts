import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuthResponse } from "@shilabs/shared-types";
import { createApp } from "../../app.js";
import { prisma } from "../../shared/prisma.js";
import { hashPassword } from "../auth/auth.service.js";
import { categories } from "./privacy.schemas.js";
import { previewPrivacyCleanup, runWorkspaceRetention, savePrivacyPolicy } from "./privacy.service.js";
import type { AuthenticatedUser } from "../auth/auth.types.js";

const marker = `privacy-integration-${randomUUID()}`;
const old = new Date("2020-01-01T00:00:00.000Z");
const app = createApp();
let primary: Awaited<ReturnType<typeof fixture>>;
let other: Awaited<ReturnType<typeof fixture>>;
let actor: AuthenticatedUser;
let token: string;
let repToken: string;
const workspaceIds: string[] = [];
const userIds: string[] = [];

async function fixture(label: string) {
  const workspace = await prisma.workspace.create({ data: { name: `${marker}-${label}`, slug: `${marker}-${label}` } });
  workspaceIds.push(workspace.id);
  const company = await prisma.company.create({ data: { workspaceId: workspace.id, name: `${marker}-${label}` } });
  const contact = await prisma.contact.create({ data: {
    workspaceId: workspace.id, companyId: company.id, firstName: label, lastName: "Private",
    email: `${marker}-${label}@example.local`, normalizedEmail: `${marker}-${label}@example.local`
  } });
  const stage = await prisma.pipelineStage.create({ data: { workspaceId: workspace.id, key: `${marker}-${label}`, label: "New", order: 0, probability: 10 } });
  const lead = await prisma.lead.create({ data: { workspaceId: workspace.id, companyId: company.id, contactId: contact.id, source: marker, stageId: stage.id, requirement: "Private requirement", automationOwnershipState: "AI_ACTIVE" } });
  const conversation = await prisma.conversation.create({ data: { workspaceId: workspace.id, leadId: lead.id, channel: "EMAIL" } });
  const message = await prisma.message.create({ data: { workspaceId: workspace.id, conversationId: conversation.id, direction: "INBOUND", senderType: "PROSPECT", deliveryStatus: "DELIVERED", body: `Private content ${label}`, createdAt: old } });
  const audit = await prisma.auditEvent.create({ data: { workspaceId: workspace.id, actorType: "SYSTEM", entityType: "Contact", entityId: contact.id, action: "CONTACT_CREATED", after: { email: contact.email }, metadata: { contactId: contact.id }, createdAt: old } });
  return { workspace, company, contact, lead, conversation, message, audit };
}

async function login(role: "ADMIN" | "SALES_REP") {
  const user = await prisma.user.create({ data: {
    email: `${marker}-${role}@example.local`.toLowerCase(), passwordHash: await hashPassword("PrivacyTest123!"),
    firstName: "Privacy", lastName: role, role, status: "ACTIVE",
    workspaceMemberships: { create: { workspaceId: primary.workspace.id, role, status: "ACTIVE" } }
  } });
  userIds.push(user.id);
  const response = await request(app).post("/api/auth/login").send({ email: user.email, password: "PrivacyTest123!" }).expect(200);
  return { user, token: (response.body as AuthResponse).accessToken };
}

beforeAll(async () => {
  const schema = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unused").searchParams.get("schema") ?? "";
  if (process.env.NODE_ENV !== "test" || !/^codex_test_[A-Za-z0-9_]+$/.test(schema)) {
    throw new Error("Privacy integration tests require an explicitly selected codex_test_* schema; never use public or the development database");
  }
  primary = await fixture("primary");
  other = await fixture("other");
  const admin = await login("ADMIN");
  actor = { ...admin.user, activeWorkspaceId: primary.workspace.id, activeWorkspaceRole: "ADMIN" };
  token = admin.token;
  repToken = (await login("SALES_REP")).token;
});

afterAll(async () => {
  if (!workspaceIds.length) return;
  const where = { workspaceId: { in: workspaceIds } };
  await prisma.domainEventOutbox.deleteMany({ where });
  await prisma.auditEvent.deleteMany({ where });
  await prisma.activity.deleteMany({ where });
  await prisma.task.deleteMany({ where });
  await prisma.leadIntelligence.deleteMany({ where });
  await prisma.leadDocument.deleteMany({ where });
  await prisma.message.deleteMany({ where });
  await prisma.conversation.deleteMany({ where });
  await prisma.lead.deleteMany({ where });
  await prisma.contact.deleteMany({ where });
  await prisma.company.deleteMany({ where });
  await prisma.pipelineStage.deleteMany({ where });
  await prisma.authSession.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.workspace.deleteMany({ where: { id: { in: workspaceIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
});

describe("privacy integration against an isolated PostgreSQL schema", () => {
  it("executes preview queries for ALL categories, including enum, JSON-null and relation filters", async () => {
    await savePrivacyPolicy(actor, { enabled: false, revision: 0, periods: Object.fromEntries(categories.map((category) => [category, 30])) });
    const preview = await previewPrivacyCleanup(actor);
    expect(Object.keys(preview.counts).sort()).toEqual([...categories].sort());
    expect(preview.counts.messages).toBeGreaterThanOrEqual(1);
    expect(preview.counts.audit).toBeGreaterThanOrEqual(1);
    expect((await prisma.message.findUniqueOrThrow({ where: { id: primary.message.id } })).body).toBe("Private content primary");
  });

  it("applies only old message content in the selected workspace and refuses replay", async () => {
    const recent = await prisma.message.create({ data: { workspaceId: primary.workspace.id, conversationId: primary.conversation.id, direction: "INBOUND", senderType: "PROSPECT", deliveryStatus: "DELIVERED", body: "Recent content" } });
    const preview = await request(app).post("/api/privacy/cleanup/preview").set("Authorization", `Bearer ${token}`).set("x-workspace-id", primary.workspace.id).expect(200);
    const previewBody = preview.body as { previewId: string };
    const body = { previewId: previewBody.previewId, confirmation: "APPLY CLEANUP" };
    await request(app).post("/api/privacy/cleanup/apply").set("Authorization", `Bearer ${token}`).set("x-workspace-id", primary.workspace.id).send(body).expect(200);
    expect((await prisma.message.findUniqueOrThrow({ where: { id: primary.message.id } })).body).toBe("[redacted]");
    expect((await prisma.message.findUniqueOrThrow({ where: { id: recent.id } })).body).toBe("Recent content");
    expect((await prisma.message.findUniqueOrThrow({ where: { id: other.message.id } })).body).toBe("Private content other");
    await request(app).post("/api/privacy/cleanup/apply").set("Authorization", `Bearer ${token}`).set("x-workspace-id", primary.workspace.id).send(body).expect(409);
  });

  it("exports allowlisted data and erases personal details while preserving audit IDs and another workspace", async () => {
    const document = await prisma.leadDocument.create({ data: { workspaceId: primary.workspace.id, leadId: primary.lead.id, title: "Private report", kind: "REPORT", sourceType: "UPLOAD", extractedText: "Private document", status: "INDEXED", chunks: { create: { workspaceId: primary.workspace.id, leadId: primary.lead.id, position: 0, content: "Private chunk" } } } });
    const opaqueAudit = await prisma.auditEvent.create({ data: { workspaceId: primary.workspace.id, actorType: "SYSTEM", entityType: "Import", entityId: "opaque-import", action: "IMPORTED", metadata: { nested: { email: primary.contact.email } } } });
    const pendingEvent = await prisma.domainEventOutbox.create({ data: { workspaceId: primary.workspace.id, eventType: "privacy.test", aggregateType: "Lead", aggregateId: primary.lead.id, payload: { email: primary.contact.email }, correlationId: marker, idempotencyKey: marker, status: "PENDING" } });
    const exported = await request(app).get(`/api/privacy/contacts/${primary.contact.id}/export`).set("Authorization", `Bearer ${token}`).set("x-workspace-id", primary.workspace.id).expect("Cache-Control", "no-store").expect(200);
    const exportedBody = exported.body as { records: Record<string, { email?: string }[]> };
    expect(exportedBody.records.Contact?.[0]?.email).toBe(primary.contact.email);
    expect(exportedBody.records).not.toHaveProperty("IntegrationAccount");
    expect(exportedBody.records).not.toHaveProperty("EmailProviderEvent");
    await request(app).post(`/api/privacy/contacts/${primary.contact.id}/erase`).set("Authorization", `Bearer ${token}`).set("x-workspace-id", primary.workspace.id).send({ confirmation: "ERASE CONTACT" }).expect(200);
    const contact = await prisma.contact.findUniqueOrThrow({ where: { id: primary.contact.id } });
    expect(contact).toMatchObject({ id: primary.contact.id, email: null, firstName: "[redacted]", doNotContact: true });
    expect(contact.erasedAt).toBeInstanceOf(Date);
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: primary.lead.id } })).automationOwnershipState).toBe("AI_STOPPED");
    expect(await prisma.auditEvent.findUniqueOrThrow({ where: { id: opaqueAudit.id } })).toMatchObject({ id: opaqueAudit.id, entityId: "opaque-import", action: "IMPORTED", metadata: { redacted: true } });
    expect(await prisma.auditEvent.findUniqueOrThrow({ where: { id: primary.audit.id } })).toMatchObject({ id: primary.audit.id, createdAt: old, entityId: primary.contact.id, action: "CONTACT_CREATED" });
    expect(await prisma.contact.findUniqueOrThrow({ where: { id: other.contact.id } })).toMatchObject({ email: other.contact.email, doNotContact: false, erasedAt: null });
    expect(await prisma.auditEvent.findUniqueOrThrow({ where: { id: other.audit.id } })).toMatchObject({ after: { email: other.contact.email } });
    expect(await prisma.domainEventOutbox.findUniqueOrThrow({ where: { id: pendingEvent.id } })).toMatchObject({ status: "ATTENTION_REQUIRED", payload: { redacted: true } });
    expect(await prisma.leadDocument.findUniqueOrThrow({ where: { id: document.id } })).toMatchObject({ status: "ARCHIVED", extractedText: null });
    expect((await prisma.leadDocumentChunk.findFirstOrThrow({ where: { documentId: document.id } })).content).toBe("[redacted]");
  });

  it("returns 403 for a sales representative and 404 for a foreign contact", async () => {
    for (const path of ["/api/privacy/policy", `/api/privacy/contacts/${primary.contact.id}/export`]) {
      await request(app).get(path).set("Authorization", `Bearer ${repToken}`).set("x-workspace-id", primary.workspace.id).expect(403);
    }
    await request(app).post(`/api/privacy/contacts/${primary.contact.id}/erase`).set("Authorization", `Bearer ${repToken}`).set("x-workspace-id", primary.workspace.id).send({ confirmation: "ERASE CONTACT" }).expect(403);
    await request(app).get(`/api/privacy/contacts/${other.contact.id}/export`).set("Authorization", `Bearer ${token}`).set("x-workspace-id", primary.workspace.id).expect(404);
  });

  it("defaults scheduling to disabled and atomically skips a duplicate due run", async () => {
    expect(await runWorkspaceRetention(other.workspace.id)).toMatchObject({ skipped: true, cleaned: 0 });
    const current = await prisma.workspacePrivacyPolicy.findUniqueOrThrow({ where: { workspaceId: primary.workspace.id } });
    await savePrivacyPolicy(actor, { enabled: true, revision: current.revision, periods: { messages: 30 } });
    const now = new Date(Date.now() + 1000);
    expect(await runWorkspaceRetention(primary.workspace.id, now)).toMatchObject({ skipped: false });
    expect(await runWorkspaceRetention(primary.workspace.id, now)).toMatchObject({ skipped: true, cleaned: 0 });
    const audit = await prisma.auditEvent.findFirstOrThrow({ where: { workspaceId: primary.workspace.id, action: "PRIVACY_CONTENT_CLEANED", actorType: "SYSTEM" } });
    expect(audit.actorUserId).toBeNull();
  });
});
