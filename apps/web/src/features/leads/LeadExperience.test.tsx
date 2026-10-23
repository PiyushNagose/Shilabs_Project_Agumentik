/**
 * @vitest-environment happy-dom
 */
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { ActivityDto } from "@shilabs/shared-types";
import { LeadTimeline } from "./LeadExperience.js";

const occurredAt = "2026-10-16T08:30:00.000Z";

function activity(patch: Partial<ActivityDto> = {}): ActivityDto {
  return {
    id: "activity_1",
    leadId: "lead_1",
    entityType: "LEAD",
    entityId: "lead_1",
    actorType: "SYSTEM",
    actorUserId: null,
    actorAgentId: null,
    sourceType: "CONVERSATION",
    sourceId: "conversation_1",
    type: "MESSAGE_RECEIVED",
    title: "MESSAGE_RECEIVED",
    summary: "The customer replied with rollout requirements.",
    description: "The customer replied with rollout requirements.",
    metadata: {},
    occurredAt,
    correlationId: null,
    visibility: "BUSINESS",
    createdAt: occurredAt,
    actorUser: null,
    ...patch
  };
}

describe("LeadTimeline", () => {
  afterEach(cleanup);

  it("renders business-readable activity labels with semantic timestamps", () => {
    render(<LeadTimeline activities={[activity()]} />);

    const timeline = screen.getByLabelText("Lead business activity");
    expect(within(timeline).getByText("Customer replied")).toBeTruthy();
    expect(within(timeline).queryByText("MESSAGE_RECEIVED")).toBeNull();
    expect(within(timeline).getByText("System")).toBeTruthy();
    expect(within(timeline).getByText(/customer replied with rollout requirements/i)).toBeTruthy();
    expect(timeline.querySelector("time")?.getAttribute("datetime")).toBe(occurredAt);
  });

  it("translates ownership transitions instead of exposing internal state names", () => {
    render(
      <LeadTimeline
        activities={[
          activity({
            type: "AUTOMATION_OWNERSHIP_CHANGED",
            title: "AUTOMATION_OWNERSHIP_CHANGED",
            metadata: { from: "HUMAN_ACTION_COMPLETED", to: "AI_ACTIVE" }
          })
        ]}
      />
    );

    expect(screen.getByText("AI following up")).toBeTruthy();
    expect(screen.getByText("AI is handling the scheduled follow-up.")).toBeTruthy();
    expect(screen.queryByText(/AI_ACTIVE|HUMAN_ACTION_COMPLETED/)).toBeNull();
  });

  it("does not present legacy automation failures as customer replies", () => {
    render(<LeadTimeline activities={[activity({
      description: "AI lead automation startup failed: A salesperson must review this follow-up.",
      summary: "AI lead automation startup failed: A salesperson must review this follow-up."
    })]} />);
    expect(screen.queryByText("Customer replied")).toBeNull();
    expect(screen.getByText("Automatic follow-up needs attention")).toBeTruthy();
  });
});
