import { describe, expect, it } from "vitest";
import { demoApiResponse } from "./demo-api.js";

describe("demo API", () => {
  it("returns coherent list and detail records", () => {
    const page = demoApiResponse("/api/leads?page=1&pageSize=50") as {
      items: Array<{ id: string; company: { name: string } }>;
      total: number;
    };

    expect(page.total).toBe(8);
    expect(page.items[0]?.company.name).toBe("Northstar Labs");
    expect(demoApiResponse(`/api/leads/${page.items[0]!.id}`)).toMatchObject({
      id: page.items[0]!.id,
      company: { name: "Northstar Labs" }
    });
  });

  it("keeps related records workspace-local and lead-scoped", () => {
    const tasks = demoApiResponse("/api/tasks?leadId=lead-1") as Array<{ leadId: string }>;
    const deals = demoApiResponse("/api/deals?stageId=stage-qualified") as {
      items: Array<{ leadId: string; stageId: string }>;
    };

    expect(tasks).toHaveLength(1);
    expect(tasks.every((task) => task.leadId === "lead-1")).toBe(true);
    expect(deals.items.every((deal) => deal.stageId === "stage-qualified")).toBe(true);
  });

  it("exposes dashboard and agent data without a backend", () => {
    expect(demoApiResponse("/api/action-dashboard")).toMatchObject({
      summary: { totalActionItems: 3 }
    });
    expect(demoApiResponse("/api/agents/agent-outreach")).toMatchObject({
      id: "agent-outreach",
      executions: expect.any(Array)
    });
  });
});
