import { afterEach, describe, expect, it, vi } from "vitest";
import { apiRequest } from "./core.js";
import { escalateNotification } from "./notifications.js";

vi.mock("./core.js", () => ({ apiRequest: vi.fn() }));

describe("notification escalation API adapter", () => {
  afterEach(() => vi.clearAllMocks());
  it("uses the existing authenticated PATCH endpoint and encodes the notification ID", async () => {
    vi.mocked(apiRequest).mockResolvedValue({ id: "notification", status: "ESCALATED" });
    const body = { reason: "Manager review", escalationDueAt: "2026-10-20T09:00:00.000Z" };
    await expect(escalateNotification("token", "notification/foreign", body)).resolves.toEqual({
      id: "notification",
      status: "ESCALATED"
    });
    expect(apiRequest).toHaveBeenCalledWith(
      "/api/notifications/notification%2Fforeign/escalate",
      "token",
      {
        method: "PATCH",
        body: JSON.stringify(body)
      }
    );
  });
});
