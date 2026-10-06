import { describe, expect, it } from "vitest";
import type { ReplyUnderstandingResult } from "../ai/ai.provider.js";
import { hasExplicitDncStopSignal, safeReplyUnderstandingOutput } from "./reply-policy.js";

function meetingOutput(
  quote: string,
  draftResponse: string | null = null
): ReplyUnderstandingResult {
  return {
    intent: "MEETING_REQUEST",
    confidence: 0.9,
    summary: "Provider classified this as a meeting request.",
    draftResponse,
    requiresHumanReview: true,
    recommendedAction: "MEETING_REVIEW",
    evidence: [{ messageId: "message-1", quote }],
    usedKnowledgeIds: []
  };
}

function normalize(body: string, draftResponse: string | null = null): ReplyUnderstandingResult {
  return safeReplyUnderstandingOutput(meetingOutput(body, draftResponse), [
    { id: "message-1", senderType: "PROSPECT", body }
  ]);
}

describe("reply meeting intent policy", () => {
  it("does not treat what-would-you-suggest-next-step wording as a meeting request", () => {
    const result = normalize(
      "We want to automate this process while still keeping our sales team in control. What would you suggest as the next step?"
    );

    expect(result.intent).toBe("QUESTION");
    expect(result.recommendedAction).toBe("DRAFT_RESPONSE");
  });

  it("does not treat what-should-we-do-next wording as a meeting request", () => {
    const result = normalize("Thanks, this sounds useful. What should we do next?");

    expect(result.intent).toBe("QUESTION");
    expect(result.recommendedAction).toBe("DRAFT_RESPONSE");
  });

  it("keeps explicit schedule-a-meeting wording on the meeting workflow", () => {
    const result = normalize("Can we schedule a meeting next week?");

    expect(result.intent).toBe("MEETING_REQUEST");
    expect(result.recommendedAction).toBe("MEETING_REVIEW");
    expect(result.draftResponse).toBeNull();
  });

  it("keeps explicit demo or call wording on the meeting workflow", () => {
    const result = normalize("I'd like a demo/call with your team before we move ahead.");

    expect(result.intent).toBe("MEETING_REQUEST");
    expect(result.recommendedAction).toBe("MEETING_REVIEW");
  });

  it("downgrades ambiguous wording to review instead of inventing a meeting", () => {
    const result = normalize("This looks useful. Maybe we can move forward sometime soon.");

    expect(result.intent).toBe("UNCLEAR");
    expect(result.recommendedAction).toBe("NO_ACTION");
    expect(result.draftResponse).toBeNull();
  });
});

describe("reply DNC policy", () => {
  it("recognizes explicit stop/unsubscribe language without treating simple disinterest as DNC", () => {
    expect(hasExplicitDncStopSignal("Please unsubscribe me and stop emailing us.")).toBe(true);
    expect(hasExplicitDncStopSignal("Don't contact me again.")).toBe(true);
    expect(hasExplicitDncStopSignal("No thanks, we are not interested right now.")).toBe(false);
  });
});
