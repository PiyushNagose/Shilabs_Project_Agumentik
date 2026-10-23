import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { RealtimeRelay } from "./realtime-relay.js";

describe.skipIf(!process.env.REDIS_URL)("shared realtime relay", () => {
  it("delivers between independent instances without echoing to the publisher", async () => {
    const channel = `shilabs:test:realtime:${randomUUID()}`;
    const messages: unknown[] = [];
    const errors: string[] = [];
    let received: (event: unknown) => void = () => undefined;
    const eventReceived = new Promise<unknown>((resolve) => {
      received = resolve;
    });
    const first = new RealtimeRelay(
      process.env.REDIS_URL ?? "",
      channel,
      (event) => {
        messages.push(event);
        return Promise.resolve();
      },
      () => {
        errors.push("relay error");
      }
    );
    const second = new RealtimeRelay(
      process.env.REDIS_URL ?? "",
      channel,
      (event) => {
        received(event);
        return Promise.resolve();
      },
      () => {
        errors.push("relay error");
      }
    );
    try {
      await Promise.all([first.waitUntilReady(), second.waitUntilReady()]);
      const event = {
        type: "realtime:update",
        entityType: "lead",
        action: "lead-updated",
        workspaceId: "workspace-a",
        leadId: "lead-a",
        occurredAt: new Date().toISOString()
      };
      await first.publish(event);
      await expect(eventReceived).resolves.toEqual(event);
      expect(messages).toEqual([]);
      expect(errors).toEqual([]);
      await expect(first.publish({ ...event, workspaceId: undefined })).rejects.toThrow();
    } finally {
      first.close();
      second.close();
    }
  }, 10000);
});
