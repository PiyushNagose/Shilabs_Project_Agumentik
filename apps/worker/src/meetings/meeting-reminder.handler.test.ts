import type { DomainEventOutbox, Prisma } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { publishWorkerRealtimeEvent } from "../realtime/realtime.publisher.js";

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  publish: vi.fn<typeof publishWorkerRealtimeEvent>()
}));
vi.mock("../domain-events/domain-event.repository.js", () => ({
  workerPrisma: { $transaction: mocks.transaction }
}));
vi.mock("../realtime/realtime.publisher.js", () => ({ publishWorkerRealtimeEvent: mocks.publish }));
vi.mock("../followups/zoho-timeline.syncer.js", () => ({ ZohoTimelineSyncer: vi.fn() }));

import { handleMeetingReminder } from "./meeting-reminder.handler.js";
import { meetingDomainEventHandlers } from "./meeting-confirmed.handler.js";
import { PermanentDomainEventError } from "../domain-events/domain-event.errors.js";

function fixture() {
  const event = {
    id: "event-1",
    workspaceId: "workspace-1",
    aggregateId: "meeting-1",
    aggregateType: "MeetingRequest",
    eventType: "MEETING_REMINDER_DUE",
    payload: { leadId: "untrusted-lead", selectedSlotId: "slot-1" }
  } as unknown as DomainEventOutbox;
  const request = {
    id: "meeting-1",
    workspaceId: "workspace-1",
    leadId: "lead-1",
    conversationId: "conversation-1",
    ownerId: "owner-1" as string | null,
    requestedByUserId: "requester-1",
    status: "CONFIRMED",
    selectedSlotId: "slot-1",
    completedAt: null as Date | null,
    reminderSentAt: null as Date | null,
    reminderMinutes: 30,
    title: "Discovery",
    timeZone: "Asia/Kolkata",
    updatedAt: new Date("2026-10-22T09:00:00Z"),
    slots: [
      {
        id: "slot-1",
        startsAt: new Date("2026-10-22T10:30:00Z"),
        endsAt: new Date("2026-10-22T11:00:00Z")
      }
    ]
  };
  const notifications = new Map<string, unknown>();
  const findFirst = vi.fn(({ where }: Prisma.MeetingRequestFindFirstArgs) =>
    Promise.resolve(
      where?.workspaceId === request.workspaceId && where.id === request.id
        ? structuredClone(request)
        : null
    )
  );
  const updateMany = vi.fn(() => {
    if (request.reminderSentAt) return Promise.resolve({ count: 0 });
    request.reminderSentAt = new Date();
    return Promise.resolve({ count: 1 });
  });
  const upsert = vi.fn(({ where, create }: Prisma.InternalNotificationUpsertArgs) => {
    if (!where.idempotencyKey) throw new Error("Notification requires an idempotency key");
    if (!notifications.has(where.idempotencyKey)) notifications.set(where.idempotencyKey, create);
    return Promise.resolve(notifications.get(where.idempotencyKey));
  });
  const tx = { meetingRequest: { findFirst, updateMany }, internalNotification: { upsert } };
  mocks.transaction.mockImplementation(async (run: (client: typeof tx) => Promise<unknown>) => {
    const snapshot = structuredClone(request);
    const savedNotifications = new Map(notifications);
    try {
      return await run(tx);
    } catch (error) {
      Object.assign(request, snapshot);
      notifications.clear();
      for (const [key, value] of savedNotifications) notifications.set(key, value);
      throw error;
    }
  });
  return { event, request, findFirst, updateMany, upsert, notifications };
}

describe("meeting reminders (no database)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-22T10:00:00Z"));
    mocks.publish.mockResolvedValue(undefined);
  });
  afterEach(() => vi.useRealTimers());

  it("registers the reminder handler", () => {
    expect(meetingDomainEventHandlers.MEETING_REMINDER_DUE).toEqual({
      handle: handleMeetingReminder
    });
  });

  it("atomically claims a due meeting and creates an owner notification using persisted context", async () => {
    const f = fixture();
    await handleMeetingReminder(f.event);
    expect(f.findFirst).toHaveBeenCalledWith({
      where: { id: "meeting-1", workspaceId: "workspace-1" },
      include: { slots: { where: { id: "slot-1", status: "SELECTED" } } }
    });
    expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: "Serializable"
    });
    expect(f.updateMany).toHaveBeenCalledWith({
      where: {
        id: "meeting-1",
        workspaceId: "workspace-1",
        status: "CONFIRMED",
        selectedSlotId: "slot-1",
        completedAt: null,
        reminderSentAt: null,
        updatedAt: f.request.updatedAt
      },
      data: { reminderSentAt: new Date() }
    });
    expect([...f.notifications.values()]).toEqual([
      expect.objectContaining({
        workspaceId: "workspace-1",
        type: "MEETING_CONFIRMATION",
        status: "UNREAD",
        assignedToUserId: "owner-1",
        meetingRequestId: "meeting-1",
        leadId: "lead-1",
        conversationId: "conversation-1",
        idempotencyKey:
          "notification:meeting-reminder:workspace-1:meeting-1:slot-1:2026-10-22T10:30:00.000Z"
      })
    ]);
    expect([...f.notifications.values()][0]).not.toHaveProperty("escalationDueAt");
    expect(f.request.reminderSentAt).toEqual(new Date());
    expect(mocks.publish.mock.calls.map(([input]) => input.entityType)).toEqual([
      "notifications",
      "meeting"
    ]);
    expect(mocks.publish.mock.calls[0]?.[0].event.payload).toEqual({
      leadId: "lead-1",
      conversationId: "conversation-1"
    });
  });

  it.each([
    "CANCELLED",
    "CONFIRMATION_REQUIRED",
    "PROVIDER_PENDING",
    "ATTENTION_REQUIRED",
    "COMPLETED"
  ])("skips %s meetings", async (status) => {
    const f = fixture();
    f.request.status = status;
    await handleMeetingReminder(f.event);
    expect(f.updateMany).not.toHaveBeenCalled();
    expect(f.upsert).not.toHaveBeenCalled();
    expect(mocks.publish).not.toHaveBeenCalled();
  });

  it.each([
    "completed",
    "stale",
    "missing slot",
    "disabled",
    "foreign workspace",
    "missing meeting"
  ])("skips a %s reminder", async (reason) => {
    const f = fixture();
    if (reason === "completed") f.request.completedAt = new Date();
    if (reason === "stale") f.request.selectedSlotId = "slot-2";
    if (reason === "missing slot") f.request.slots = [];
    if (reason === "disabled") f.request.reminderMinutes = 0;
    if (reason === "foreign workspace") f.event.workspaceId = "workspace-2";
    if (reason === "missing meeting") f.event.aggregateId = "missing";
    await handleMeetingReminder(f.event);
    expect(f.updateMany).not.toHaveBeenCalled();
    expect(f.upsert).not.toHaveBeenCalled();
    expect(f.request.reminderSentAt).toBeNull();
    expect(mocks.publish).not.toHaveBeenCalled();
  });

  it.each([
    ["Asia/Kolkata", "4:00 PM", "GMT+5:30"],
    ["America/New_York", "6:30 AM", "EDT"]
  ])("formats the meeting start in %s with its timezone", async (timeZone, time, zone) => {
    const f = fixture();
    f.request.timeZone = timeZone;
    await handleMeetingReminder(f.event);
    const body = f.upsert.mock.calls[0]?.[0].create.body;
    expect(body).toContain("Oct 22, 2026");
    expect(body).toContain(time);
    expect(body).toContain(zone);
    expect(body).not.toContain("10:30:00.000Z");
  });

  it.each(["2026-10-22T11:00:00Z", "2026-10-22T11:00:00.001Z"])(
    "skips ended meetings at %s",
    async (now) => {
      const f = fixture();
      vi.setSystemTime(new Date(now));
      await handleMeetingReminder(f.event);
      expect(f.updateMany).not.toHaveBeenCalled();
      expect(f.upsert).not.toHaveBeenCalled();
      expect(f.request.reminderSentAt).toBeNull();
      expect(mocks.publish).not.toHaveBeenCalled();
    }
  );

  it("allows a delayed reminder while the meeting is still ongoing", async () => {
    const f = fixture();
    vi.setSystemTime(new Date("2026-10-22T10:59:59.999Z"));
    await handleMeetingReminder(f.event);
    expect(f.notifications.size).toBe(1);
  });

  it("throws a retryable error on early delivery, then delivers once due", async () => {
    const f = fixture();
    vi.setSystemTime(new Date("2026-10-22T09:59:59.999Z"));
    const delivery = handleMeetingReminder(f.event);
    await expect(delivery).rejects.toThrow("Meeting reminder is not due yet");
    await expect(delivery).rejects.not.toBeInstanceOf(PermanentDomainEventError);
    expect(f.updateMany).not.toHaveBeenCalled();
    expect(f.upsert).not.toHaveBeenCalled();
    expect(mocks.publish).not.toHaveBeenCalled();
    expect(f.request.reminderSentAt).toBeNull();
    vi.setSystemTime(new Date("2026-10-22T10:00:00Z"));
    await handleMeetingReminder(f.event);
    await handleMeetingReminder(f.event);
    expect(f.upsert).toHaveBeenCalledTimes(1);
    expect(f.notifications.size).toBe(1);
  });

  it.each([null, {}, [], { selectedSlotId: " " }])(
    "rejects malformed payload %j",
    async (payload) => {
      const f = fixture();
      f.event.payload = payload;
      await expect(handleMeetingReminder(f.event)).rejects.toMatchObject({
        code: "MEETING_REMINDER_INVALID"
      });
      expect(mocks.transaction).not.toHaveBeenCalled();
    }
  );

  it.each(["workspaceId", "aggregateType", "eventType"])("rejects invalid %s", async (field) => {
    const f = fixture();
    Object.assign(f.event, { [field]: "" });
    await expect(handleMeetingReminder(f.event)).rejects.toMatchObject({
      code: "MEETING_REMINDER_INVALID"
    });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("deduplicates distinct events for the same slot", async () => {
    const f = fixture();
    await handleMeetingReminder(f.event);
    await handleMeetingReminder({ ...f.event, id: "event-2" });
    expect(f.upsert).toHaveBeenCalledTimes(1);
    expect(f.notifications.size).toBe(1);
  });

  it("creates a separate reminder after rescheduling and clearing the sent marker", async () => {
    const f = fixture();
    await handleMeetingReminder(f.event);
    f.request.selectedSlotId = "slot-2";
    f.request.slots = [
      {
        id: "slot-2",
        startsAt: new Date("2026-10-22T10:30:00Z"),
        endsAt: new Date("2026-10-22T11:00:00Z")
      }
    ];
    f.request.reminderSentAt = null;
    await handleMeetingReminder({ ...f.event, payload: { selectedSlotId: "slot-2" } });
    expect(f.notifications.size).toBe(2);
  });

  it("skips a claim lost to a concurrent meeting update", async () => {
    const f = fixture();
    f.updateMany.mockResolvedValueOnce({ count: 0 });
    await handleMeetingReminder(f.event);
    expect(f.upsert).not.toHaveBeenCalled();
    expect(mocks.publish).not.toHaveBeenCalled();
  });

  it("rolls back the sent marker when notification persistence fails and allows retry", async () => {
    const f = fixture();
    f.upsert.mockRejectedValueOnce(new Error("database unavailable"));
    await expect(handleMeetingReminder(f.event)).rejects.toThrow("database unavailable");
    expect(f.request.reminderSentAt).toBeNull();
    expect(mocks.publish).not.toHaveBeenCalled();
    await handleMeetingReminder(f.event);
    expect(f.notifications.size).toBe(1);
  });

  it("propagates transaction conflicts so the outbox can retry", async () => {
    const f = fixture();
    mocks.transaction.mockRejectedValueOnce(new Error("serialization conflict"));
    await expect(handleMeetingReminder(f.event)).rejects.toThrow("serialization conflict");
    await handleMeetingReminder(f.event);
    expect(f.notifications.size).toBe(1);
  });

  it("retries realtime after commit without duplicating the notification", async () => {
    const f = fixture();
    mocks.publish.mockRejectedValueOnce(new Error("publisher configuration failed"));
    await expect(handleMeetingReminder(f.event)).rejects.toThrow("publisher configuration failed");
    await handleMeetingReminder(f.event);
    expect(f.upsert).toHaveBeenCalledTimes(1);
    expect(f.notifications.size).toBe(1);
    expect(mocks.publish).toHaveBeenLastCalledWith(
      expect.objectContaining({ entityType: "meeting" })
    );
  });

  it("assigns an ownerless meeting to its requester", async () => {
    const f = fixture();
    f.request.ownerId = null;
    await handleMeetingReminder(f.event);
    expect(f.upsert.mock.calls[0]?.[0].create.assignedToUserId).toBe("requester-1");
  });
});
