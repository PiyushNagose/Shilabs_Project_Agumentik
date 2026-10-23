import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import { prisma } from "../../shared/prisma.js";
import { stopAiInTransaction } from "../leads/lead-automation-ownership.service.js";
import { publishRealtimeEvent } from "../realtime/realtime.service.js";
import { applyPrivacyCleanup, eraseContactData, exportContactData, getPrivacyPolicy, previewPrivacyCleanup, privacyTable, runDueWorkspaceRetention, runWorkspaceRetention, safeExportValue, savePrivacyPolicy } from "./privacy.service.js";
import { erasureRules } from "./privacy.records.js";
import type { AuthenticatedUser } from "../auth/auth.types.js";

vi.mock("../../shared/prisma.js", () => ({ prisma: {} }));
vi.mock("../leads/lead-automation-ownership.service.js", () => ({ stopAiInTransaction: vi.fn() }));
vi.mock("../realtime/realtime.service.js", () => ({ publishRealtimeEvent: vi.fn() }));
const actor = { id: "user-a", role: "ADMIN", activeWorkspaceRole: "ADMIN", activeWorkspaceId: "workspace-a" } as AuthenticatedUser;
interface MockArguments {
  where?: Record<string, unknown>;
  data?: Record<string, unknown>;
  select?: Record<string, boolean>;
  take?: number;
}
type Row = Record<string, unknown>;
function mockDelegate() {
  return {
    findMany: vi.fn<(args: MockArguments) => Promise<Row[]>>().mockResolvedValue([]),
    findUnique: vi.fn<(args: MockArguments) => Promise<Row | null>>().mockResolvedValue(null),
    findFirst: vi.fn<(args: MockArguments) => Promise<Row | null>>().mockResolvedValue(null),
    count: vi.fn<(args: MockArguments) => Promise<number>>().mockResolvedValue(0),
    updateMany: vi.fn<(args: MockArguments) => Promise<{ count: number }>>().mockResolvedValue({ count: 0 }),
    update: vi.fn<(args: MockArguments) => Promise<Row>>().mockResolvedValue({}),
    deleteMany: vi.fn<(args: MockArguments) => Promise<{ count: number }>>().mockResolvedValue({ count: 0 }),
    upsert: vi.fn<(args: MockArguments) => Promise<Row>>().mockResolvedValue({}),
    create: vi.fn<(args: MockArguments) => Promise<Row>>().mockResolvedValue({ id: "preview-a", expiresAt: new Date(Date.now() + 60000) })
  };
}
function mockTransaction() {
  const delegates = Object.fromEntries(erasureRules.map((rule) => [rule.model.slice(0, 1).toLowerCase() + rule.model.slice(1), mockDelegate()]));
  return {
    ...delegates,
    workspacePrivacyPolicy: mockDelegate(), privacyCleanup: mockDelegate(),
    outboundEmail: mockDelegate(), inboundEmail: mockDelegate(), auditEvent: mockDelegate(),
    contact: mockDelegate(), lead: mockDelegate(), voiceCallAttempt: mockDelegate(),
    $executeRaw: vi.fn<(...args: unknown[]) => Promise<number>>().mockResolvedValue(0)
  };
}
let tx: ReturnType<typeof mockTransaction>;
function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Expected privacy mock call");
  return value;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("DATABASE_URL", "postgresql://localhost/unused?schema=codex_test_mock");
  tx = mockTransaction();
  Object.assign(prisma, tx, { $transaction: vi.fn((callback: (client: Prisma.TransactionClient) => Promise<unknown>) => callback(tx as unknown as Prisma.TransactionClient)) });
});

describe("privacy service without a database", () => {
  it("does not report a committed policy mutation as failed when realtime is unavailable", async () => {
    vi.mocked(publishRealtimeEvent).mockRejectedValueOnce(new Error("socket unavailable"));
    await expect(savePrivacyPolicy(actor, { enabled: false, revision: 0, periods: {} })).resolves.toMatchObject({ revision: 1 });
    expect(publishRealtimeEvent).toHaveBeenCalledWith({ workspaceId: "workspace-a", entityType: "workspace", action: "privacy-policy-updated" });
  });
  it("defaults to disabled and requires the active workspace role", async () => {
    await expect(getPrivacyPolicy(actor)).resolves.toEqual({ enabled: false, revision: 0, periods: {} });
    await expect(getPrivacyPolicy({ ...actor, activeWorkspaceRole: "VIEWER" })).rejects.toMatchObject({ statusCode: 403 });
    await expect(savePrivacyPolicy({ ...actor, activeWorkspaceRole: "SALES_MANAGER" }, { enabled: false, revision: 0, periods: {} })).rejects.toMatchObject({ statusCode: 403 });
    await expect(getPrivacyPolicy({ ...actor, activeWorkspaceId: undefined })).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rejects stale policy writes before modifying settings", async () => {
    tx.workspacePrivacyPolicy.findUnique.mockResolvedValue({ enabled: false, revision: 2, periods: {} });
    await expect(savePrivacyPolicy(actor, { enabled: false, revision: 1, periods: {} })).rejects.toMatchObject({ statusCode: 409 });
    expect(tx.workspacePrivacyPolicy.upsert).not.toHaveBeenCalled();
  });
  it("creates a bounded preview without scrubbing content", async () => {
    tx.workspacePrivacyPolicy.findUnique.mockResolvedValue({ enabled: false, revision: 1, periods: { email: 30 } });
    tx.outboundEmail.findMany.mockResolvedValue(Array.from({ length: 501 }, (_, i) => ({ id: `email-${String(i)}` })));
    const preview = await previewPrivacyCleanup(actor);
    expect(preview.counts.email).toBe(500);
    expect(preview.hasMore).toBe(true);
    expect(required(tx.inboundEmail.findMany.mock.calls[0])[0].take).toBe(1);
    expect(tx.outboundEmail.updateMany).not.toHaveBeenCalled();
    expect(JSON.stringify(tx.outboundEmail.findMany.mock.calls)).toContain("workspace-a");
  });
  it.each(["expired", "applied", "changed"])("rejects %s cleanup previews", async (reason) => {
    tx.privacyCleanup.findFirst.mockResolvedValue({ id: "preview-a", workspaceId: "workspace-a", expiresAt: new Date(Date.now() + (reason === "expired" ? -60000 : 60000)), appliedAt: reason === "applied" ? new Date() : null, policyRevision: reason === "changed" ? 2 : 0, plan: [] });
    await expect(applyPrivacyCleanup(actor, "preview-a")).rejects.toMatchObject({ statusCode: 409 });
    expect(tx.outboundEmail.updateMany).not.toHaveBeenCalled();
    expect(tx.privacyCleanup.findFirst).toHaveBeenCalledWith({ where: { id: "preview-a", workspaceId: "workspace-a" } });
  });
  it("applies only exact preview IDs and rechecks workspace, age and pending work", async () => {
    tx.privacyCleanup.findFirst.mockResolvedValue({ id: "preview-a", expiresAt: new Date(Date.now() + 60000), appliedAt: null, policyRevision: 0, plan: [{ rule: 0, ids: ["email-a"], cutoff: "2026-01-01T00:00:00.000Z", more: false }] });
    tx.outboundEmail.updateMany.mockResolvedValue({ count: 1 });
    await expect(applyPrivacyCleanup(actor, "preview-a")).resolves.toEqual({ cleaned: 1 });
    const query = required(tx.outboundEmail.updateMany.mock.calls[0])[0];
    expect(query.where).toHaveProperty("AND.1", { id: { in: ["email-a"] } });
    expect(JSON.stringify(query.where)).toContain("workspace-a");
    expect(JSON.stringify(query.where)).toContain("PENDING");
    expect(required(tx.auditEvent.create.mock.calls[0])[0].data).toMatchObject({ actorType: "USER", actorId: "user-a", action: "PRIVACY_CONTENT_CLEANED" });
  });
  it("claims only enabled due policies in active workspaces and skips duplicate runs", async () => {
    await expect(runWorkspaceRetention("workspace-a")).resolves.toMatchObject({ skipped: true, cleaned: 0 });
    expect(tx.privacyCleanup.create).not.toHaveBeenCalled();
    expect(required(tx.workspacePrivacyPolicy.updateMany.mock.calls[0])[0].where).toMatchObject({ workspaceId: "workspace-a", enabled: true, workspace: { status: "ACTIVE" } });
    tx.workspacePrivacyPolicy.findMany.mockResolvedValue([]);
    await runDueWorkspaceRetention();
    expect(required(tx.workspacePrivacyPolicy.findMany.mock.calls[0])[0].take).toBe(5);
  });
  it("records scheduled cleanup as SYSTEM without a fake user", async () => {
    tx.workspacePrivacyPolicy.updateMany.mockResolvedValue({ count: 1 });
    tx.privacyCleanup.findFirst.mockResolvedValue({ id: "preview-a", expiresAt: new Date(Date.now() + 60000), appliedAt: null, policyRevision: 0, plan: [] });
    await runWorkspaceRetention("workspace-a");
    expect(required(tx.auditEvent.create.mock.calls[0])[0].data).toMatchObject({ actorType: "SYSTEM", actorId: null, actorUserId: null });
  });
  it("does not export integration accounts, raw payloads, metadata or signed links", async () => {
    tx.contact.findFirst.mockResolvedValue({ id: "contact-a" });
    const result = await exportContactData(actor, "contact-a");
    expect(result.records).not.toHaveProperty("IntegrationAccount");
    expect(result.records).not.toHaveProperty("AuditEvent");
    expect(required(tx.outboundEmail.findMany.mock.calls[0])[0].select).not.toHaveProperty("attachmentMetadata");
    expect(safeExportValue("token=private https://example.local/file?secret=hidden Bearer abc.def"))
      .toBe("token=[REDACTED] [link omitted] [REDACTED]");
  });
  it("refuses cross-workspace contacts and active calls", async () => {
    await expect(eraseContactData(actor, "foreign")).rejects.toMatchObject({ statusCode: 404 });
    expect(stopAiInTransaction).not.toHaveBeenCalled();
    tx.contact.findFirst.mockResolvedValue({ id: "contact-a" });
    tx.voiceCallAttempt.count.mockResolvedValue(1);
    await expect(eraseContactData(actor, "contact-a")).rejects.toMatchObject({ statusCode: 409 });
    expect(tx.contact.updateMany).not.toHaveBeenCalled();
  });
  it("sets DNC, stops automation in the same transaction, scrubs payloads and keeps the contact stub", async () => {
    tx.contact.findFirst.mockResolvedValue({ id: "contact-a", email: "person@example.local", erasedAt: null });
    tx.lead.findMany.mockResolvedValue([{ id: "lead-a" }]);
    await eraseContactData(actor, "contact-a");
    expect(stopAiInTransaction).toHaveBeenCalledWith(expect.objectContaining({ client: tx, leadId: "lead-a", reason: "PRIVACY_ERASURE" }));
    expect(required(tx.contact.updateMany.mock.calls[0])[0]).toEqual({ where: { id: "contact-a", workspaceId: "workspace-a" }, data: { doNotContact: true } });
    const contactData = required(required(tx.contact.updateMany.mock.calls.at(-1))[0].data);
    expect(contactData.erasedAt).toBeInstanceOf(Date);
    expect(contactData.doNotContact).toBe(true);
    expect(tx.$executeRaw).toHaveBeenCalled();
    expect(required(required(tx.auditEvent.create.mock.calls.at(-1))[0].data).action).toBe("CONTACT_DATA_ERASED");
  });
  it("qualifies raw tables using the configured schema and rejects injected identifiers", () => {
    const previous = process.env.DATABASE_URL;
    try {
      process.env.DATABASE_URL = "postgresql://localhost/test?schema=codex_test_privacy";
      expect(privacyTable("AuditEvent").sql).toBe('"codex_test_privacy"."AuditEvent"');
      process.env.DATABASE_URL = "postgresql://localhost/test?schema=bad%22%3B";
      expect(() => privacyTable("AuditEvent")).toThrow("Invalid database schema");
    } finally { if (previous === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previous; }
  });
});
