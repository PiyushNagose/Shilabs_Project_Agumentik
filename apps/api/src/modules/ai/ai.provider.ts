import type { z } from "zod";
import type {
  aiInputSchema,
  salesReplyResultSchema,
  qualificationResultSchema,
  leadSummaryResultSchema,
  followUpResultSchema,
  proposalDraftResultSchema,
  replyUnderstandingResultSchema,
  briefingResultSchema
} from "./ai.schemas.js";

export type SalesReplyInput = z.infer<typeof aiInputSchema>;
export type QualificationInput = SalesReplyInput;
export type LeadSummaryInput = SalesReplyInput;
export type FollowUpInput = SalesReplyInput;
export type SalesReplyResult = z.infer<typeof salesReplyResultSchema>;
export type QualificationResult = z.infer<typeof qualificationResultSchema>;
export type LeadSummaryResult = z.infer<typeof leadSummaryResultSchema>;
export type FollowUpResult = z.infer<typeof followUpResultSchema>;
export type ProposalDraftInput = SalesReplyInput;
export type ProposalDraftResult = z.infer<typeof proposalDraftResultSchema>;
export type ReplyUnderstandingInput = SalesReplyInput;
export type ReplyUnderstandingResult = z.infer<typeof replyUnderstandingResultSchema>;
export type BriefingInput = SalesReplyInput;
export type BriefingResult = z.infer<typeof briefingResultSchema>;

export interface AIProvider {
  generateSalesReply(input: SalesReplyInput): Promise<SalesReplyResult>;
  extractQualification(input: QualificationInput): Promise<QualificationResult>;
  summarizeLead(input: LeadSummaryInput): Promise<LeadSummaryResult>;
  generateFollowUp(input: FollowUpInput): Promise<FollowUpResult>;
  generateProposalDraft(input: ProposalDraftInput): Promise<ProposalDraftResult>;
  understandReply(input: ReplyUnderstandingInput): Promise<ReplyUnderstandingResult>;
  generateBriefing(input: BriefingInput): Promise<BriefingResult>;
  createEmbedding(text: string): Promise<number[]>;
}
