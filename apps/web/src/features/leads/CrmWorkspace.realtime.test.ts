import { describe, expect, it } from "vitest";
import {
  mergeCrmRealtimeRefreshPlans,
  planCrmRealtimeRefresh
} from "./CrmWorkspace.js";

describe("CRM realtime refresh planning", () => {
  it("targets follow-up domain events without requesting a full workspace reload", () => {
    const plan = planCrmRealtimeRefresh(
      {
        type: "realtime:update",
        entityType: "domain-event",
        action: "domain-event-processed",
        leadId: "lead_1",
        sourceEventType: "FOLLOWUP_EMAIL_SEND_REQUESTED",
        occurredAt: new Date().toISOString()
      },
      "lead_1"
    );

    expect(plan).toMatchObject({
      fullWorkspace: false,
      leadList: true,
      lead: true,
      conversations: true,
      qualification: true,
      notifications: true
    });
  });

  it("coalesces multiple operation events into one targeted plan", () => {
    const proposalPlan = planCrmRealtimeRefresh(
      {
        type: "realtime:update",
        entityType: "domain-event",
        action: "domain-event-processed",
        leadId: "lead_1",
        sourceEventType: "PROPOSAL_SEND_REQUESTED",
        occurredAt: new Date().toISOString()
      },
      "lead_1"
    );
    const meetingPlan = planCrmRealtimeRefresh(
      {
        type: "realtime:update",
        entityType: "domain-event",
        action: "domain-event-processed",
        leadId: "lead_1",
        sourceEventType: "MEETING_CONFIRMATION_SEND_REQUESTED",
        occurredAt: new Date().toISOString()
      },
      "lead_1"
    );

    if (!proposalPlan || !meetingPlan) {
      throw new Error("Expected refresh plans");
    }

    expect(mergeCrmRealtimeRefreshPlans(proposalPlan, meetingPlan)).toMatchObject({
      fullWorkspace: false,
      leadList: true,
      lead: true,
      proposals: true,
      meetings: true,
      notifications: true
    });
  });

  it("refreshes both lead views for an AI stage update without a workspace reload", () => {
    const plan = planCrmRealtimeRefresh(
      {
        type: "realtime:update",
        entityType: "lead",
        action: "lead-stage-changed",
        leadId: "lead_1",
        occurredAt: new Date().toISOString()
      },
      "lead_1"
    );

    expect(plan).toMatchObject({
      fullWorkspace: false,
      leadList: true,
      lead: true,
      notifications: true
    });
  });

  it("keeps broad workspace reloads for reconnect only", () => {
    expect(
      planCrmRealtimeRefresh(
        {
          type: "realtime:reconnected",
          entityType: "workspace",
          action: "reconnected",
          occurredAt: new Date().toISOString()
        },
        "lead_1"
      )
    ).toMatchObject({ fullWorkspace: true, conversations: true });
  });
});
