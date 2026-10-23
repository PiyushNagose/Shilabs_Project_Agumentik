import { describe, expect, it } from "vitest";
import { executionTiming, formatDateTime } from "./date-time.js";

const base = { status: "QUEUED", startedAt: "2026-10-21T05:57:00Z", completedAt: null };
describe("execution timing", () => {
  it("uses the scheduled time, never the creation/start fallback, for pending work", () => {
    expect(
      executionTiming(
        { ...base, nextRunAt: "2026-10-22T05:57:00Z" },
        Date.parse("2026-10-21T05:57:00Z")
      )
    ).toEqual({
      label: "Scheduled for",
      at: "2026-10-22T05:57:00Z",
      detail: "Awaiting execution"
    });
    expect(executionTiming(base).at).toBeNull();
    expect(
      executionTiming(
        { ...base, nextRunAt: "2026-10-22T05:57:00Z" },
        Date.parse("2026-10-23T05:57:00Z")
      )
    ).toMatchObject({
      detail: "Past scheduled time; awaiting execution",
      at: "2026-10-22T05:57:00Z"
    });
  });
  it("keeps waiting, running, human review and completion distinct", () => {
    expect(
      executionTiming({ ...base, status: "WAITING", nextRunAt: "2026-10-23T05:57:00Z" }).label
    ).toBe("Resumes at");
    expect(executionTiming({ ...base, status: "HUMAN_REQUIRED" }).at).toBeNull();
    expect(executionTiming({ ...base, status: "RUNNING", actualStartedAt: null }).at).toBeNull();
    expect(executionTiming({ ...base, status: "SUCCEEDED" })).toMatchObject({
      label: "Completed at",
      at: null,
      detail: "Finish time not recorded"
    });
    expect(
      executionTiming({ ...base, status: "FAILED", completedAt: "2026-10-21T06:00:00Z" })
    ).toMatchObject({ label: "Failed at", at: "2026-10-21T06:00:00Z" });
  });
  it("handles missing/invalid dates and shows a timezone for valid times", () => {
    expect(formatDateTime(null)).toBe("Not scheduled");
    expect(formatDateTime("invalid")).toBe("Time unavailable");
    expect(formatDateTime(base.startedAt)).toMatch(/GMT|UTC|IST|[A-Z]{2,4}/);
  });
});
