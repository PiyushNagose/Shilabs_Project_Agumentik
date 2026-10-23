import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthenticatedUser } from "../auth/auth.types.js";

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  updateMany: vi.fn(),
  findFirstOrThrow: vi.fn(),
  audit: vi.fn(),
  publish: vi.fn<(input: { maxAttempts?: number; client?: unknown }) => Promise<void>>(),
  realtime: vi.fn()
}));
vi.mock("../../shared/prisma.js", () => ({
  prisma: {
    internalNotification: { findFirst: mocks.findFirst },
    $transaction: (run: (tx: unknown) => unknown) =>
      run({
        internalNotification: {
          updateMany: mocks.updateMany,
          findFirstOrThrow: mocks.findFirstOrThrow
        },
        auditEvent: { create: mocks.audit }
      })
  }
}));
vi.mock("../domain-events/domain-events.service.js", () => ({ publishDomainEvent: mocks.publish }));
vi.mock("../realtime/realtime.service.js", () => ({ publishRealtimeEvent: mocks.realtime }));
vi.mock("../auth/auth.service.js", () => ({ toPublicUser: vi.fn() }));
import { escalateNotification } from "./notification.service.js";

const manager = {
  id: "manager",
  activeWorkspaceId: "workspace",
  activeWorkspaceRole: "SALES_MANAGER"
} as AuthenticatedUser;
function record() {
  return {
    id: "notification",
    workspaceId: "workspace",
    assignedToUserId: "manager",
    status: "UNREAD",
    escalationStatus: "NONE",
    sourceEntityType: "Task",
    sourceEntityId: "task",
    createdAt: new Date(),
    updatedAt: new Date(),
    negotiationHandoff: null
  };
}

describe("escalation creation without database access", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findFirst.mockResolvedValue(record());
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.findFirstOrThrow.mockResolvedValue({
      ...record(),
      status: "ESCALATED",
      escalationStatus: "ESCALATED"
    });
  });

  it("keeps the workspace boundary and publishes a retryable transactional event", async () => {
    await escalateNotification(manager, "notification", { reason: "Overdue" });
    expect(mocks.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "notification", workspaceId: "workspace" }
      })
    );
    expect(mocks.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: "notification",
          workspaceId: "workspace",
          escalationStatus: { not: "ESCALATED" }
        }
      })
    );
    expect(mocks.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "NOTIFICATION_ESCALATED"
      })
    );
    expect(mocks.publish.mock.calls[0]?.[0].maxAttempts).toBeGreaterThan(1);
    expect(mocks.publish.mock.calls[0]?.[0].client).toBeDefined();
    expect(mocks.updateMany.mock.calls[0]?.[0]).toMatchObject({
      data: { escalationEvidence: { delivery: { state: "Pending", channel: "EMAIL" } } }
    });
  });

  it("does not publish twice when another escalation transaction won", async () => {
    mocks.updateMany.mockResolvedValue({ count: 0 });
    await escalateNotification(manager, "notification", { reason: "Overdue" });
    expect(mocks.publish).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("does not reset delivery evidence after acknowledgment", async () => {
    mocks.findFirst.mockResolvedValue({
      ...record(),
      status: "ACKNOWLEDGED",
      escalationStatus: "ESCALATED"
    });
    await escalateNotification(manager, "notification", { reason: "Overdue" });
    expect(mocks.updateMany).not.toHaveBeenCalled();
    expect(mocks.publish).not.toHaveBeenCalled();
  });

  it("rejects non-manager escalation even when already escalated", async () => {
    mocks.findFirst.mockResolvedValue({ ...record(), escalationStatus: "ESCALATED" });
    await expect(
      escalateNotification({ ...manager, activeWorkspaceRole: "SALES_REP" }, "notification", {
        reason: "Overdue"
      })
    ).rejects.toThrow("Only managers");
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it("does not access a notification outside the active workspace", async () => {
    mocks.findFirst.mockResolvedValue(null);
    await expect(escalateNotification(manager, "foreign", { reason: "Overdue" })).rejects.toThrow(
      "not found"
    );
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });
});
