import type { ReplyUnderstandingResult } from "../ai/ai.provider.js";

export const explicitNegotiationSignals = [
  "negotiate",
  "negotiation",
  "reduce the price",
  "reduce price",
  "better commercial deal",
  "better deal",
  "price is too high",
  "pricing is higher",
  "too expensive",
  "discount",
  "commercial terms"
] as const;

export function recommendedActionForIntent(
  intent: ReplyUnderstandingResult["intent"]
): ReplyUnderstandingResult["recommendedAction"] {
  if (intent === "NOT_INTERESTED") return "STOP_AUTOMATION";
  if (intent === "NEGOTIATION") return "HUMAN_HANDOFF";
  if (intent === "PROPOSAL_REQUEST") return "PROPOSAL_REVIEW";
  if (intent === "MEETING_REQUEST") return "MEETING_REVIEW";
  if (intent === "UNCLEAR") return "NO_ACTION";
  return "DRAFT_RESPONSE";
}

export function intentRequiresHumanReviewGate(intent: string | null): boolean {
  return (
    intent === "NEGOTIATION" ||
    intent === "PROPOSAL_REQUEST" ||
    intent === "MEETING_REQUEST"
  );
}

export function safeReplyUnderstandingOutput(
  output: ReplyUnderstandingResult
): ReplyUnderstandingResult {
  const recommendedAction = recommendedActionForIntent(output.intent);
  const humanHandoff = intentRequiresHumanReviewGate(output.intent);
  return {
    ...output,
    recommendedAction,
    requiresHumanReview: true,
    draftResponse: humanHandoff || output.intent === "NOT_INTERESTED" ? null : output.draftResponse
  };
}
