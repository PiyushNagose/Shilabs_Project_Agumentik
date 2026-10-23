import { describe, expect, it, vi } from "vitest";
import type { DomainEventOutbox, PrismaClient } from "@prisma/client";
import { NotificationDeliveryService } from "./notification-delivery.service.js";
import type { WorkerEmailSendInput } from "../integrations/aws-ses.provider.js";

function fixture(env: NodeJS.ProcessEnv = {}) {
  const event = {
    id: "event",
    aggregateId: "notification",
    aggregateType: "InternalNotification",
    eventType: "NOTIFICATION_ESCALATED",
    workspaceId: "workspace",
    attempts: 1,
    maxAttempts: 5,
    payload: { to: "customer@example.com", notificationId: "foreign-notification" }
  } as unknown as DomainEventOutbox;
  const notification = {
    id: "notification",
    workspaceId: "workspace",
    escalationStatus: "ESCALATED",
    assignedToUserId: "manager",
    title: "Review\r\nneeded",
    body: "Internal details",
    escalationReason: "Overdue",
    escalationDueAt: null,
    escalationEvidence: {
      reason: "Overdue",
      delivery: { state: "Pending" } as Record<string, unknown>
    }
  };
  const members = [
    { userId: "manager", role: "SALES_MANAGER", user: { email: "manager@example.com" } }
  ];
  const findFirst = vi.fn(({ where }: { where: { workspaceId: string; id: string } }) =>
    Promise.resolve(
      where.workspaceId === notification.workspaceId && where.id === notification.id
        ? structuredClone(notification)
        : null
    )
  );
  interface UpdateInput {
    where: { escalationEvidence: { equals: unknown } };
    data: { escalationEvidence: typeof notification.escalationEvidence };
  }
  const updateMany = vi.fn(({ where, data }: UpdateInput) => {
    if (
      JSON.stringify(where.escalationEvidence.equals) !==
      JSON.stringify(notification.escalationEvidence)
    ) {
      return Promise.resolve({ count: 0 });
    }
    notification.escalationEvidence = structuredClone(data.escalationEvidence);
    return Promise.resolve({ count: 1 });
  });
  const audit = vi.fn<() => Promise<object>>().mockResolvedValue({});
  const findMany = vi.fn(() => Promise.resolve(members));
  const tx = { internalNotification: { updateMany }, auditEvent: { create: audit } };
  const db = {
    internalNotification: { findFirst },
    workspaceMember: { findMany },
    $transaction: vi.fn((run: (client: typeof tx) => Promise<unknown>) => run(tx))
  } as unknown as PrismaClient;
  const sendEmail = vi
    .fn<(input: WorkerEmailSendInput) => Promise<{ providerMessageId: string }>>()
    .mockResolvedValue({ providerMessageId: "provider-123" });
  const service = new NotificationDeliveryService(
    db,
    {
      NOTIFICATION_ESCALATION_ENABLED: "true",
      EMAIL_PROVIDER: "MAILPIT",
      ...env
    },
    { sendEmail }
  );
  return {
    service,
    event,
    notification,
    members,
    sendEmail,
    audit,
    findFirst,
    findMany,
    updateMany
  };
}

describe("internal escalation delivery (no database)", () => {
  it("sends to the active workspace manager, records acceptance, and deduplicates replay", async () => {
    const f = fixture();
    await f.service.deliver(f.event);
    await f.service.deliver(f.event);
    expect(f.sendEmail).toHaveBeenCalledTimes(1);
    expect(f.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "manager@example.com",
        subject: "Escalation: Review  needed",
        idempotencyKey: "notification-escalation:notification"
      })
    );
    expect(f.notification.escalationEvidence).toEqual(
      expect.objectContaining({
        reason: "Overdue"
      })
    );
    expect(f.notification.escalationEvidence.delivery).toEqual(
      expect.objectContaining({
        state: "Accepted",
        providerMessageId: "provider-123",
        recipientUserId: "manager"
      })
    );
    expect(f.audit).toHaveBeenCalledTimes(2);
    expect(f.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          workspaceId: "workspace",
          status: "ACTIVE",
          workspace: { status: "ACTIVE" },
          role: { in: ["OWNER", "ADMIN", "SALES_MANAGER"] },
          user: { status: "ACTIVE" }
        }
      })
    );
  });

  it("only one concurrent invocation acquires the durable claim", async () => {
    const f = fixture();
    await Promise.all([f.service.deliver(f.event), f.service.deliver(f.event)]);
    expect(f.sendEmail).toHaveBeenCalledTimes(1);
  });

  it("does not send across workspaces or trust payload identifiers", async () => {
    const f = fixture();
    f.event.workspaceId = "other-workspace";
    await expect(f.service.deliver(f.event)).rejects.toThrow("not in this workspace");
    expect(f.sendEmail).not.toHaveBeenCalled();
    expect(f.findMany).not.toHaveBeenCalled();
  });

  it("rejects missing workspace and wrong aggregate before lookup", async () => {
    const f = fixture();
    f.event.workspaceId = null;
    await expect(f.service.deliver(f.event)).rejects.toThrow("Invalid escalation event");
    f.event.workspaceId = "workspace";
    f.event.aggregateType = "Lead";
    await expect(f.service.deliver(f.event)).rejects.toThrow("Invalid escalation event");
    expect(f.findFirst).not.toHaveBeenCalled();
  });

  it.each([
    [{ NOTIFICATION_ESCALATION_ENABLED: "false" }, "Disabled"],
    [{ EMAIL_PROVIDER: "AWS_SES" }, "NeedsAttention"],
    [{ APP_ENV: "production" }, "NeedsAttention"]
  ])("fails closed for configuration %j", async (env, state) => {
    const f = fixture(env);
    await f.service.deliver(f.event);
    expect(f.notification.escalationEvidence.delivery.state).toBe(state);
    expect(f.sendEmail).not.toHaveBeenCalled();
  });

  it("requires a current internal recipient and never uses customer payload addresses", async () => {
    const f = fixture();
    f.members.length = 0;
    await f.service.deliver(f.event);
    expect(f.sendEmail).not.toHaveBeenCalled();
    expect(f.notification.escalationEvidence.delivery).toEqual(
      expect.objectContaining({
        state: "NeedsAttention",
        code: "ACTIVE_INTERNAL_RECIPIENT_MISSING"
      })
    );
  });

  it("prefers the assigned manager, then a workspace owner", async () => {
    const f = fixture();
    f.members.unshift({ userId: "owner", role: "OWNER", user: { email: "owner@example.com" } });
    await f.service.deliver(f.event);
    expect(f.sendEmail.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ to: "manager@example.com" })
    );
    const fallback = fixture();
    fallback.notification.assignedToUserId = "removed-user";
    fallback.members.push({ userId: "owner", role: "OWNER", user: { email: "owner@example.com" } });
    await fallback.service.deliver(fallback.event);
    expect(fallback.sendEmail.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ to: "owner@example.com" })
    );
  });

  it("never retries ambiguous provider errors or records their secrets", async () => {
    const f = fixture();
    f.sendEmail.mockRejectedValueOnce(new Error("timeout with secret-access-key"));
    await f.service.deliver(f.event);
    await f.service.deliver(f.event);
    expect(f.sendEmail).toHaveBeenCalledTimes(1);
    expect(f.notification.escalationEvidence.delivery.state).toBe("NeedsAttention");
    expect(JSON.stringify(f.notification)).not.toContain("secret-access-key");
    expect(JSON.stringify(f.audit.mock.calls)).not.toContain("secret-access-key");
  });

  it("treats missing provider acceptance evidence as ambiguous", async () => {
    const f = fixture();
    f.sendEmail.mockResolvedValueOnce({ providerMessageId: "" });
    await f.service.deliver(f.event);
    await f.service.deliver(f.event);
    expect(f.sendEmail).toHaveBeenCalledTimes(1);
    expect(f.notification.escalationEvidence.delivery.state).toBe("NeedsAttention");
  });

  it("retries only definitive SES throttling rejection", async () => {
    const f = fixture({
      EMAIL_PROVIDER: "AWS_SES",
      AWS_SES_REGION: "us-east-1",
      AWS_SES_FROM_EMAIL: "alerts@example.com",
      AWS_SES_ACCESS_KEY_ID: "test",
      AWS_SES_SECRET_ACCESS_KEY: "test"
    });
    f.sendEmail.mockRejectedValueOnce(
      Object.assign(new Error("rate limited"), { name: "TooManyRequestsException" })
    );
    await expect(f.service.deliver(f.event)).rejects.toThrow("retry permitted");
    expect(f.notification.escalationEvidence.delivery.state).toBe("Pending");
    f.event.attempts++;
    await f.service.deliver(f.event);
    expect(f.notification.escalationEvidence.delivery.state).toBe("Accepted");
    expect(f.sendEmail).toHaveBeenCalledTimes(2);
  });

  it("leaves an interrupted send claim non-retryable", async () => {
    const f = fixture();
    f.notification.escalationEvidence.delivery = { state: "NeedsAttention" };
    await f.service.deliver(f.event);
    expect(f.sendEmail).not.toHaveBeenCalled();
  });

  it("stops retrying a definitive rejection at the attempt limit", async () => {
    const f = fixture({
      EMAIL_PROVIDER: "AWS_SES",
      AWS_SES_REGION: "us-east-1",
      AWS_SES_FROM_EMAIL: "alerts@example.com",
      AWS_SES_ACCESS_KEY_ID: "test",
      AWS_SES_SECRET_ACCESS_KEY: "test"
    });
    f.event.attempts = f.event.maxAttempts;
    f.sendEmail.mockRejectedValueOnce(
      Object.assign(new Error("rate limited"), {
        name: "TooManyRequestsException"
      })
    );
    await f.service.deliver(f.event);
    await f.service.deliver(f.event);
    expect(f.notification.escalationEvidence.delivery).toMatchObject({
      state: "NeedsAttention",
      code: "RETRY_EXHAUSTED"
    });
    expect(f.sendEmail).toHaveBeenCalledTimes(1);
  });

  it("does not send if the durable claim cannot commit", async () => {
    const f = fixture();
    f.updateMany.mockRejectedValueOnce(new Error("database unavailable"));
    await expect(f.service.deliver(f.event)).rejects.toThrow("database unavailable");
    expect(f.sendEmail).not.toHaveBeenCalled();
    expect(f.notification.escalationEvidence.delivery.state).toBe("Pending");
  });

  it("does not send if the transactional audit write fails", async () => {
    const f = fixture();
    f.audit.mockRejectedValueOnce(new Error("audit unavailable"));
    await expect(f.service.deliver(f.event)).rejects.toThrow("audit unavailable");
    expect(f.sendEmail).not.toHaveBeenCalled();
  });

  it("retains the claim when persisting acceptance fails", async () => {
    const f = fixture();
    f.updateMany
      .mockImplementationOnce(({ data }) => {
        f.notification.escalationEvidence = structuredClone(data.escalationEvidence);
        return Promise.resolve({ count: 1 });
      })
      .mockRejectedValueOnce(new Error("database unavailable"));
    await expect(f.service.deliver(f.event)).rejects.toThrow("database unavailable");
    await f.service.deliver(f.event);
    expect(f.sendEmail).toHaveBeenCalledTimes(1);
    expect(f.notification.escalationEvidence.delivery.state).toBe("NeedsAttention");
  });
});
