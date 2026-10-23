import { describe, expect, it, vi } from "vitest";
import { runRetentionCleanup } from "./retention.runner.js";

describe("retention runner", () => {
  it("uses the authenticated internal endpoint and detects partial workspace failures", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ results: [{ failed: true }] })));
    await expect(
      runRetentionCleanup(
        { WORKER_API_BASE_URL: "http://localhost:4010", REALTIME_INTERNAL_SECRET: "test-secret" },
        request
      )
    ).rejects.toThrow("requires attention");
    const call = request.mock.calls[0];
    expect(call?.[0]).toBe("http://localhost:4010/api/privacy/internal/run-due");
    expect(call?.[1]?.method).toBe("POST");
    expect(new Headers(call?.[1]?.headers).get("x-shilabs-realtime-secret")).toBe("test-secret");
  });
  it("fails safely when the API is unavailable", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 503 }));
    await expect(runRetentionCleanup({}, request)).rejects.toThrow("503");
  });
  it("does not start unauthenticated cleanup in production", async () => {
    const request = vi.fn<typeof fetch>();
    await expect(runRetentionCleanup({ NODE_ENV: "production" }, request)).rejects.toThrow(
      "internal secret"
    );
    expect(request).not.toHaveBeenCalled();
  });
});
