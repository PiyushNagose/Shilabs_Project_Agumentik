import { describe, expect, it } from "vitest";
import { followUpReadyAt, getFollowUpDays } from "./followup-timing.js";

describe("follow-up schedule", () => {
  it("treats day zero as the human response and applies lead modes", () => {
    expect(getFollowUpDays([0, 2, 5, 8])).toEqual([2, 5, 8]);
    expect(getFollowUpDays([0, 2, 5, 8], "LOW_FREQUENCY")).toEqual([7, 14, 21]);
    expect(getFollowUpDays([0, 2, 5, 8], "AGGRESSIVE")).toEqual([1, 2, 3]);
    expect(getFollowUpDays([0, 2, 5, 8], "CUSTOM", [10, 3, 3])).toEqual([3, 10]);
  });
  it("honors the later of the persisted send time and a promised next-action date", () => {
    const base = { sequenceCreatedAt: new Date("2026-10-01T10:00:00Z"), scheduledAt: new Date("2026-10-03T10:00:00Z"), stepIndex: 0, cadenceDays: [2, 5], cadenceMode: "PRODUCTION_DAYS" };
    expect(followUpReadyAt(base).toISOString()).toBe("2026-10-03T10:00:00.000Z");
    expect(followUpReadyAt({ ...base, nextActionAt: new Date("2026-10-06T10:00:00Z") }).toISOString())
      .toBe("2026-10-06T10:00:00.000Z");
  });
});
