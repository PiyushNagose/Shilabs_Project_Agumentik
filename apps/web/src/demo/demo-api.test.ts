import { describe, expect, it } from "vitest";
import type {
  AiCommandCenterDto,
  IntegrationDashboardDto,
  LeadIntelligenceDto,
  OrderDto,
  OrderSummaryDto,
  PaginatedResponse,
  WorkflowDashboardDto,
  WorkflowDetailDto
} from "@shilabs/shared-types";
import { demoApiResponse } from "./demo-api.js";

describe("demo API", () => {
  it("returns coherent list and detail records", () => {
    const page = demoApiResponse("/api/leads?page=1&pageSize=50") as {
      items: { id: string; company: { name: string } }[];
      total: number;
    };

    expect(page.total).toBe(8);
    expect(page.items[0]?.company.name).toBe("Northstar Labs");
    const firstLead = page.items[0];
    if (!firstLead) throw new Error("Expected at least one demo lead");
    expect(demoApiResponse(`/api/leads/${firstLead.id}`)).toMatchObject({
      id: firstLead.id,
      company: { name: "Northstar Labs" }
    });
  });

  it("keeps related records workspace-local and lead-scoped", () => {
    const tasks = demoApiResponse("/api/tasks?leadId=lead-1") as { leadId: string }[];
    const deals = demoApiResponse("/api/deals?stageId=stage-qualified") as {
      items: { leadId: string; stageId: string }[];
    };

    expect(tasks).toHaveLength(1);
    expect(tasks.every((task) => task.leadId === "lead-1")).toBe(true);
    expect(deals.items.every((deal) => deal.stageId === "stage-qualified")).toBe(true);
  });

  it("exposes dashboard and agent data without a backend", () => {
    expect(demoApiResponse("/api/action-dashboard")).toMatchObject({
      summary: { totalActionItems: 3 }
    });
    const agent = demoApiResponse("/api/agents/agent-outreach") as {
      id: string;
      executions: unknown[];
    };
    expect(agent.id).toBe("agent-outreach");
    expect(Array.isArray(agent.executions)).toBe(true);
  });

  it("exposes manager intelligence and grounded lead memory in preview mode", () => {
    const commandCenter = demoApiResponse(
      "/api/lead-intelligence/command-center"
    ) as AiCommandCenterDto;
    const intelligence = demoApiResponse(
      "/api/lead-intelligence/leads/lead-1"
    ) as LeadIntelligenceDto;
    expect(commandCenter.metrics).toMatchObject({ activeLeads: 10, aiActive: 6 });
    expect(commandCenter.recommendations.length).toBeGreaterThan(0);
    expect(intelligence).toMatchObject({
      leadId: "lead-1",
      aiControlStatus: "ON",
      documents: [{ status: "INDEXED" }]
    });
  });

  it("exposes a coherent Phase 11 order queue and detail", () => {
    const orders = demoApiResponse("/api/orders?paymentStatus=PAID") as PaginatedResponse<OrderDto>;
    const summary = demoApiResponse("/api/orders/summary") as OrderSummaryDto;
    expect(orders.items.length).toBeGreaterThan(0);
    expect(orders.items.every((order) => order.paymentStatus === "PAID")).toBe(true);
    const first = orders.items[0];
    if (!first) throw new Error("Expected at least one demo order");
    expect(demoApiResponse(`/api/orders/${first.id}`)).toMatchObject({
      id: first.id,
      company: { id: first.companyId }
    });
    expect(summary.totalOrders).toBeGreaterThan(0);
    expect(Number(summary.averageOrderValue)).toBeGreaterThan(0);
  });

  it("exposes workflow builder and integration health data in preview mode", () => {
    const workflows = demoApiResponse("/api/workflows") as WorkflowDashboardDto;
    const workflow = demoApiResponse(
      "/api/workflows/workflow-governed-follow-up"
    ) as WorkflowDetailDto;
    const integrations = demoApiResponse("/api/integrations") as IntegrationDashboardDto;

    expect(workflows.summary).toMatchObject({ total: 1, published: 1 });
    expect(workflow.currentVersion?.definition.nodes.length).toBeGreaterThan(4);
    expect(workflow.currentVersion?.definition.edges.length).toBeGreaterThan(4);
    expect(integrations.summary).toMatchObject({ total: 4, needsAttention: 1 });
    expect(integrations.connections.some((item) => item.status === "CONNECTED")).toBe(true);
  });
});
