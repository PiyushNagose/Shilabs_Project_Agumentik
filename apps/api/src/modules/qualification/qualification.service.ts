import type { Prisma } from "@prisma/client";
import type { LeadQualificationDto } from "@shilabs/shared-types";
import { AppError } from "../../shared/errors.js";
import { createAIProvider } from "../ai/ai.factory.js";
import type { AIProvider } from "../ai/ai.provider.js";
import type { AuthenticatedUser } from "../auth/auth.types.js";
import { isNonMeaningfulInboundMetadata } from "../email/inbound-email-classification.js";
import { findLeadById } from "../leads/lead.repository.js";
import { assertCanMutateLead } from "../leads/lead.permissions.js";
import { publishRealtimeEvent } from "../realtime/realtime.service.js";
import {
  findLeadForQualification,
  findQualificationByLeadId,
  listMessagesForLeadByIds,
  listRecentMessagesForLead,
  upsertQualificationWithEvidence,
  type LeadQualificationRecord
} from "./qualification.repository.js";
import { qualificationEvents } from "./qualification.events.js";
import type {
  QualificationResultWithNulls,
  UpdateQualificationInput
} from "./qualification.schemas.js";
import { qualificationResultWithNullsSchema } from "./qualification.schemas.js";

const RECENT_MESSAGE_LIMIT = 50;

const textQualificationFields = [
  "need",
  "requirement",
  "budget",
  "budgetBand",
  "authority",
  "timeline",
  "businessFit",
  "urgency"
] as const;

type TextQualificationField = (typeof textQualificationFields)[number];
type QualificationField = TextQualificationField | "decisionMakerIdentified";

const unknownQualificationValue =
  /^(?:unknown|not known|not provided|not specified|not confirmed|n\/a)$/iu;
const budgetDisclosure =
  /(?:\b(?:our|the|approved|allocated|available|project|total|maximum|max)\s+budget\b|\bbudget\s+(?:is|of|around|approximately|about|up to|under|between|has been|was|approved|allocated)\b|(?:₹|\$|usd|inr|eur|gbp)\s*[\d,.]+\s+(?:budget|allocation))/iu;
const authorityDisclosure =
  /(?:\bi am\s+(?:the\s+)?(?:owner|founder|decision[- ]maker|approver|ceo|cfo|cto|director|head)\b|\bi (?:can|cannot|can't|will|won't) approve\b|\b(?:decision[- ]maker|approver)\s+(?:is|will be)\b)/iu;

function sanitizeAIQualification(
  input: QualificationResultWithNulls,
  messages: { body: string }[]
): QualificationResultWithNulls {
  const conversation = messages.map((message) => message.body).join("\n");
  const clean = (value: string | null): string | null =>
    value && !unknownQualificationValue.test(value.trim()) ? value : null;
  const hasBudgetDisclosure = budgetDisclosure.test(conversation);
  const hasAuthorityDisclosure = authorityDisclosure.test(conversation);

  return {
    ...input,
    need: clean(input.need),
    requirement: clean(input.requirement),
    budget: hasBudgetDisclosure ? clean(input.budget) : null,
    budgetBand: hasBudgetDisclosure ? clean(input.budgetBand) : null,
    authority: hasAuthorityDisclosure ? clean(input.authority) : null,
    decisionMakerIdentified: hasAuthorityDisclosure ? input.decisionMakerIdentified : null,
    timeline: clean(input.timeline),
    businessFit: clean(input.businessFit),
    urgency: clean(input.urgency)
  };
}

export function toQualificationDto(qualification: LeadQualificationRecord): LeadQualificationDto {
  return {
    id: qualification.id,
    leadId: qualification.leadId,
    need: qualification.need,
    requirement: qualification.requirement,
    budget: qualification.budget,
    budgetBand: qualification.budgetBand,
    authority: qualification.authority,
    timeline: qualification.timeline,
    businessFit: qualification.businessFit,
    decisionMakerIdentified: qualification.decisionMakerIdentified,
    urgency: qualification.urgency,
    createdAt: qualification.createdAt.toISOString(),
    updatedAt: qualification.updatedAt.toISOString(),
    evidence: qualification.evidence.map((item) => ({
      id: item.id,
      qualificationId: item.qualificationId,
      messageId: item.messageId,
      quote: item.quote,
      createdAt: item.createdAt.toISOString()
    }))
  };
}

function emptyQualification(leadId: string): LeadQualificationDto {
  return {
    id: null,
    leadId,
    need: null,
    requirement: null,
    budget: null,
    budgetBand: null,
    authority: null,
    timeline: null,
    businessFit: null,
    decisionMakerIdentified: null,
    urgency: null,
    createdAt: null,
    updatedAt: null,
    evidence: []
  };
}

function requireLead<TLead extends { id: string }>(lead: TLead | null): TLead {
  if (!lead) throw new AppError(404, "NOT_FOUND", "Lead not found");
  return lead;
}

function getSnapshot(
  qualification: LeadQualificationRecord | null
): Prisma.InputJsonObject | undefined {
  if (!qualification) return undefined;
  return {
    id: qualification.id,
    leadId: qualification.leadId,
    need: qualification.need,
    requirement: qualification.requirement,
    budget: qualification.budget,
    budgetBand: qualification.budgetBand,
    authority: qualification.authority,
    timeline: qualification.timeline,
    businessFit: qualification.businessFit,
    decisionMakerIdentified: qualification.decisionMakerIdentified,
    urgency: qualification.urgency,
    evidence: qualification.evidence.map((item) => ({
      messageId: item.messageId,
      quote: item.quote
    }))
  };
}

function mergeQualification(
  existing: LeadQualificationRecord | null,
  input: Partial<Record<QualificationField, string | boolean | null>>
): Prisma.LeadQualificationUncheckedCreateWithoutLeadInput {
  const merged: Prisma.LeadQualificationUncheckedCreateWithoutLeadInput = {
    need: existing?.need ?? null,
    requirement: existing?.requirement ?? null,
    budget: existing?.budget ?? null,
    budgetBand: existing?.budgetBand ?? null,
    authority: existing?.authority ?? null,
    timeline: existing?.timeline ?? null,
    businessFit: existing?.businessFit ?? null,
    decisionMakerIdentified: existing?.decisionMakerIdentified ?? null,
    urgency: existing?.urgency ?? null
  };
  for (const field of textQualificationFields) {
    if (Object.prototype.hasOwnProperty.call(input, field)) {
      const value = input[field];
      merged[field] = typeof value === "string" ? value : null;
    }
  }
  if (Object.prototype.hasOwnProperty.call(input, "decisionMakerIdentified")) {
    const value = input.decisionMakerIdentified;
    merged.decisionMakerIdentified = typeof value === "boolean" ? value : null;
  }
  return merged;
}

async function validateEvidence(
  leadId: string,
  evidence: { messageId: string; quote: string }[]
): Promise<{ messageId: string; quote: string }[]> {
  if (evidence.length === 0) return [];
  const messages = await listMessagesForLeadByIds({
    leadId,
    messageIds: [...new Set(evidence.map((item) => item.messageId))]
  });
  const messageMap = new Map(messages.map((message) => [message.id, message.body]));
  for (const item of evidence) {
    const body = messageMap.get(item.messageId);
    if (!body?.includes(item.quote)) {
      throw new AppError(
        400,
        "VALIDATION_ERROR",
        "Qualification evidence must quote a saved message"
      );
    }
  }
  return evidence;
}

export async function getQualification(leadId: string): Promise<LeadQualificationDto> {
  requireLead(await findLeadForQualification(leadId));
  const qualification = await findQualificationByLeadId(leadId);
  return qualification ? toQualificationDto(qualification) : emptyQualification(leadId);
}

export async function updateQualification(
  actor: AuthenticatedUser,
  leadId: string,
  input: UpdateQualificationInput
): Promise<LeadQualificationDto> {
  const lead = requireLead(await findLeadById(leadId));
  assertCanMutateLead(actor, lead);
  const existing = await findQualificationByLeadId(leadId);
  const evidence = await validateEvidence(leadId, input.evidence ?? existing?.evidence ?? []);
  const data = mergeQualification(existing, input);
  const qualification = await upsertQualificationWithEvidence({
    leadId,
    data,
    evidence,
    actor: { type: "USER", id: actor.id },
    activityActorUserId: actor.id,
    action: qualificationEvents.updated,
    activityDescription: "Lead qualification updated by user",
    before: getSnapshot(existing)
  });
  await publishRealtimeEvent({
    entityType: "qualification",
    action: "qualification-updated",
    leadId
  });
  return toQualificationDto(qualification);
}

export async function recalculateQualification(
  leadId: string,
  provider: AIProvider = createAIProvider()
): Promise<LeadQualificationDto> {
  const lead = await findLeadById(leadId);
  if (!lead) throw new AppError(404, "NOT_FOUND", "Lead not found");

  const recentMessages = await listRecentMessagesForLead({ leadId, take: RECENT_MESSAGE_LIMIT });
  const messages = recentMessages
    .filter((message) => !isNonMeaningfulInboundMetadata(message.metadata))
    .reverse()
    .map((message) => ({ id: message.id, senderType: message.senderType, body: message.body }));
  if (recentMessages.length > 0 && messages.length === 0) return getQualification(leadId);
  const extraction = qualificationResultWithNullsSchema.safeParse(
    await provider.extractQualification({
      messages,
      leadContext: JSON.stringify({
        leadId: lead.id,
        source: lead.source,
        requirement: lead.requirement,
        serviceInterest: lead.serviceInterest,
        company: lead.company.name,
        contact: `${lead.contact.firstName} ${lead.contact.lastName}`.trim()
      }),
      approvedKnowledge: []
    })
  );
  if (!extraction.success) {
    throw new AppError(502, "PROVIDER_ERROR", "AI provider returned an unusable response");
  }

  const sanitized = sanitizeAIQualification(extraction.data, messages);
  const evidence = await validateEvidence(leadId, sanitized.evidence);
  const existing = await findQualificationByLeadId(leadId);
  const data = mergeQualification(existing, toMergeableFields(sanitized));
  const qualification = await upsertQualificationWithEvidence({
    leadId,
    data,
    evidence,
    actor: { type: "SYSTEM", id: null },
    activityActorUserId: null,
    action: qualificationEvents.updated,
    activityDescription: "Lead qualification updated from conversation evidence",
    before: getSnapshot(existing)
  });
  await publishRealtimeEvent({
    entityType: "qualification",
    action: "qualification-recalculated",
    leadId
  });
  return toQualificationDto(qualification);
}

function toMergeableFields(
  input: QualificationResultWithNulls
): Partial<Record<QualificationField, string | boolean | null>> {
  return {
    need: input.need,
    requirement: input.requirement,
    budget: input.budget,
    budgetBand: input.budgetBand,
    authority: input.authority,
    timeline: input.timeline,
    businessFit: input.businessFit,
    decisionMakerIdentified: input.decisionMakerIdentified,
    urgency: input.urgency
  };
}
