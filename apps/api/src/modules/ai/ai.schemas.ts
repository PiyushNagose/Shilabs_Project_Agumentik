import { z } from "zod";
import { MESSAGE_SENDER_TYPES } from "@shilabs/shared-types";

const text = z.string().trim().min(1).max(12000);
export const aiInputSchema = z
  .strictObject({
    messages: z
      .array(z.strictObject({ id: text, senderType: z.enum(MESSAGE_SENDER_TYPES), body: text }))
      .max(100),
    leadContext: z.string().max(20000),
    approvedKnowledge: z.array(z.strictObject({ id: text, content: text })).max(30)
  })
  .refine((input) => JSON.stringify(input).length <= 100000, "AI context exceeds size limit");

export const salesReplyResultSchema = z.strictObject({
  body: text,
  requiresHumanReview: z.boolean(),
  reason: text.nullable()
});
export const followUpResultSchema = salesReplyResultSchema;
export const proposalDraftResultSchema = z.strictObject({
  title: z.string().trim().min(1).max(200),
  serviceType: z.string().trim().min(1).max(100).nullable(),
  content: z.string().trim().min(1).max(50000),
  usedKnowledgeIds: z.array(text).max(30),
  evidence: z
    .array(
      z.strictObject({
        sourceId: text,
        quote: text
      })
    )
    .max(50),
  requiresHumanReview: z.literal(true),
  missingInformation: z.array(text).max(20)
});
export const briefingResultSchema = z.strictObject({
  summary: text,
  requirements: text.nullable(),
  budget: text.nullable(),
  timeline: text.nullable(),
  decisionContext: text.nullable(),
  recentCommunication: text,
  qualification: text.nullable(),
  proposalDealContext: text.nullable(),
  meetingContext: text.nullable(),
  recommendedNextAction: text.nullable(),
  usedKnowledgeIds: z.array(text).max(30),
  evidence: z
    .array(
      z.strictObject({
        sourceId: text,
        quote: text
      })
    )
    .max(50),
  requiresHumanReview: z.literal(true),
  unknowns: z.array(text).max(30)
});
export const qualificationResultSchema = z.strictObject({
  need: text.nullable(),
  requirement: text.nullable(),
  budget: text.nullable(),
  budgetBand: text.nullable(),
  authority: text.nullable(),
  timeline: text.nullable(),
  businessFit: text.nullable(),
  decisionMakerIdentified: z.boolean().nullable(),
  urgency: text.nullable(),
  evidence: z.array(z.strictObject({ messageId: text, quote: text })).max(100)
});
export const leadSummaryResultSchema = z.strictObject({
  summary: text,
  buyingSignals: z.array(text).max(30),
  objections: z.array(text).max(30),
  risks: z.array(text).max(30),
  suggestedNextAction: text.nullable()
});
export const replyIntentSchema = z.enum([
  "INTERESTED",
  "NOT_INTERESTED",
  "PROPOSAL_REQUEST",
  "MEETING_REQUEST",
  "NEGOTIATION",
  "QUESTION",
  "UNCLEAR"
]);
export const replyRecommendedActionSchema = z.enum([
  "DRAFT_RESPONSE",
  "STOP_AUTOMATION",
  "HUMAN_HANDOFF",
  "PROPOSAL_REVIEW",
  "MEETING_REVIEW",
  "NO_ACTION"
]);
export const replyUnderstandingResultSchema = z.strictObject({
  intent: replyIntentSchema,
  confidence: z.number().min(0).max(1),
  summary: text,
  draftResponse: text.nullable(),
  requiresHumanReview: z.boolean(),
  recommendedAction: replyRecommendedActionSchema,
  evidence: z.array(z.strictObject({ messageId: text, quote: text })).max(20),
  usedKnowledgeIds: z.array(text).max(30)
});
export const embeddingInputSchema = z.string().trim().min(1).max(8000);
export const embeddingResultSchema = z.array(z.number()).min(1).max(8192);
