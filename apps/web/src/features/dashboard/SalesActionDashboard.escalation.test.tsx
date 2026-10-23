/** @vitest-environment happy-dom */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  InternalNotificationDto,
  SalesActionDashboardDto,
  SalesActionDashboardItemDto
} from "@shilabs/shared-types";
import { ToastProvider } from "../../components/ToastProvider.js";
import { escalateNotification } from "../../services/api/notifications.js";
import { SalesActionDashboard } from "./SalesActionDashboard.js";

const resource = vi.hoisted(() => ({
  data: null as SalesActionDashboardDto | null,
  reload: vi.fn<() => Promise<void>>()
}));
vi.mock("../../hooks/usePersistedResource.js", () => ({
  usePersistedResource: () => ({
    data: resource.data,
    reload: resource.reload,
    loading: false,
    error: null,
    updatedAt: null
  })
}));
vi.mock("../../services/api-client.js", () => ({
  acknowledgeNotification: vi.fn(),
  apiErrorMessage: vi.fn(),
  getSalesActionDashboard: vi.fn(),
  retryDomainEvent: vi.fn()
}));
vi.mock("../../services/api/notifications.js", () => ({ escalateNotification: vi.fn() }));

function setup(patch: Partial<SalesActionDashboardItemDto> = {}, canEscalate?: boolean) {
  const item: SalesActionDashboardItemDto = {
    id: "notification:alert",
    type: "NEGOTIATION_HANDOFF",
    severity: "WARNING",
    title: "Review negotiation",
    detail: "Owner review requested",
    status: "UNREAD",
    leadId: null,
    lead: null,
    conversationId: null,
    proposalId: null,
    sourceEntityType: "NegotiationHandoff",
    sourceEntityId: "handoff",
    occurredAt: "2026-10-18T10:00:00.000Z",
    ...patch
  };
  resource.data = {
    generatedAt: item.occurredAt,
    actionItems: [item],
    negotiationAndTakeoverAlerts: [item],
    pendingProposalApprovals: [],
    failuresRequiringAttention: [],
    meetings: { status: "AVAILABLE", items: [], message: "" },
    summary: {
      pendingProposalApprovals: 0,
      negotiationAndTakeoverAlerts: 1,
      failuresRequiringAttention: 0,
      meetings: 0,
      totalActionItems: 1
    }
  };
  render(
    <ToastProvider>
      <SalesActionDashboard accessToken="token" canEscalate={canEscalate} onOpenLead={vi.fn()} />
    </ToastProvider>
  );
  return ["Priority actions", "Handoffs & Takeovers"].map((name) =>
    within(screen.getByRole("region", { name }))
  );
}

describe("dashboard notification escalation parity", () => {
  beforeEach(() => {
    resource.reload.mockResolvedValue(undefined);
    vi.mocked(escalateNotification).mockResolvedValue({
      id: "alert",
      status: "ESCALATED"
    } as InternalNotificationDto);
  });
  afterEach(() => {
    cleanup();
    vi.resetAllMocks();
  });

  it("shows escalation in Priority Actions and Handoffs for managers", () => {
    for (const section of setup({}, true)) {
      expect(section.getByRole<HTMLButtonElement>("button", { name: "Escalate" }).disabled).toBe(
        false
      );
    }
  });

  it.each([false, undefined])(
    "hides escalation in both sections without manager permission (%s)",
    (canEscalate) => {
      for (const section of setup({}, canEscalate)) {
        expect(section.queryByRole("button", { name: "Escalate" })).toBeNull();
      }
    }
  );

  it.each([
    ["Pending", "Email queued"],
    ["Disabled", "Email alerts disabled"],
    ["NeedsAttention", "Email alert needs attention"],
    ["Accepted", "Email accepted by provider"]
  ] as const)(
    "shows %s delivery identically and hides repeat escalation",
    (notificationDeliveryState, label) => {
      for (const section of setup({ notificationDeliveryState }, true)) {
        expect(section.getByText(label)).toBeTruthy();
        expect(section.queryByRole("button", { name: "Escalate" })).toBeNull();
      }
    }
  );

  it("disables already escalated notifications even without delivery evidence", () => {
    for (const section of setup({ status: "ESCALATED" }, true)) {
      expect(section.getByRole<HTMLButtonElement>("button", { name: "Escalate" }).disabled).toBe(
        true
      );
    }
  });

  it("does not offer escalation for domain event rows", () => {
    for (const section of setup(
      { id: "domain-event:event", sourceEntityType: "DomainEventOutbox:CALL_FAILED" },
      true
    )) {
      expect(section.queryByRole("button", { name: "Escalate" })).toBeNull();
    }
  });

  it("submits from Priority Actions using the notification ID and refreshes the dashboard", async () => {
    setup({}, true);
    const priority = within(screen.getByRole("region", { name: "Priority actions" }));
    fireEvent.click(priority.getByRole("button", { name: "Escalate" }));
    const modal = screen.getByRole("dialog", { name: "Escalate notification" });
    fireEvent.change(within(modal).getByLabelText("Reason"), {
      target: { value: "Manager review needed" }
    });
    fireEvent.click(within(modal).getByRole("button", { name: "Escalate" }));
    await waitFor(() => expect(resource.reload).toHaveBeenCalledTimes(1));
    expect(escalateNotification).toHaveBeenCalledWith("token", "alert", {
      reason: "Manager review needed"
    });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
