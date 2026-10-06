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

const explicitDncSignalPatterns = [
  /\bunsubscribe\b/i,
  /\bstop\s+(emailing|calling|messaging|contacting)\s+(me|us)\b/i,
  /\bdo\s+not\s+(email|call|message|contact)\s+(me|us)\b/i,
  /\bdon't\s+(email|call|message|contact)\s+(me|us)\b/i,
  /\bplease\s+remove\s+(me|us)\s+from\s+(your\s+)?(list|mailing list|contact list)\b/i,
  /\bno\s+(more\s+)?(emails|calls|messages)\b/i
] as const;

const explicitMeetingSignalPatterns = [
  /\b(schedule|book|arrange|set\s*up|fix|plan)\b.{0,80}\b(meeting|call|demo|appointment|session)\b/i,
  /\b(meeting|call|demo|appointment|session)\b.{0,80}\b(schedule|book|arrange|set\s*up|fix|plan)\b/i,
  /\b(calendar|availability|available|time slot|timeslot|slot)\b/i,
  /\b(demo|discovery call|sales call|phone call|video call|zoom|google meet|teams call)\b/i,
  /\b(speak|talk|connect)\b.{0,80}\b(with|to)\b.{0,80}\b(your|the)\b.{0,80}\b(team|sales team|consultant|expert)\b/i
] as const;

const advisoryQuestionPatterns = [
  /\bwhat\s+(would|should|do)\b.{0,80}\b(next step|next steps|suggest|recommend|advise)\b/i,
  /\bwhat\s+would\s+you\s+suggest\b/i,
  /\bwhat\s+should\s+we\s+do\s+next\b/i,
  /\bnext step\b/i,
  /\bnext steps\b/i
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
  return intent === "NEGOTIATION" || intent === "PROPOSAL_REQUEST" || intent === "MEETING_REQUEST";
}

function hasExplicitMeetingSignal(text: string): boolean {
  return explicitMeetingSignalPatterns.some((pattern) => pattern.test(text));
}

function hasAdvisoryQuestionSignal(text: string): boolean {
  return advisoryQuestionPatterns.some((pattern) => pattern.test(text));
}

export function hasExplicitDncStopSignal(text: string | null | undefined): boolean {
  if (!text?.trim()) return false;
  return explicitDncSignalPatterns.some((pattern) => pattern.test(text));
}

function normalizeMeetingIntent(input: {
  output: ReplyUnderstandingResult;
  messages?: { id: string; senderType: string; body: string }[];
}): ReplyUnderstandingResult {
  if (input.output.intent !== "MEETING_REQUEST") return input.output;
  const evidenceText = input.output.evidence.map((item) => item.quote).join("\n");
  const prospectMessageText = (input.messages ?? [])
    .filter((message) => message.senderType === "PROSPECT")
    .map((message) => message.body)
    .join("\n");
  const groundedText = `${evidenceText}\n${prospectMessageText}`.trim();
  if (hasExplicitMeetingSignal(groundedText)) return input.output;
  const downgradedIntent: ReplyUnderstandingResult["intent"] =
    hasAdvisoryQuestionSignal(groundedText) || input.output.draftResponse ? "QUESTION" : "UNCLEAR";
  return {
    ...input.output,
    intent: downgradedIntent,
    draftResponse: downgradedIntent === "UNCLEAR" ? null : input.output.draftResponse
  };
}

export function safeReplyUnderstandingOutput(
  output: ReplyUnderstandingResult,
  messages?: { id: string; senderType: string; body: string }[]
): ReplyUnderstandingResult {
  const normalized = normalizeMeetingIntent({ output, messages });
  const recommendedAction = recommendedActionForIntent(normalized.intent);
  const humanHandoff = intentRequiresHumanReviewGate(normalized.intent);
  return {
    ...normalized,
    recommendedAction,
    requiresHumanReview: true,
    draftResponse:
      humanHandoff || normalized.intent === "NOT_INTERESTED" ? null : normalized.draftResponse
  };
}
