import type { Prisma } from "@prisma/client";
import type { LeadQualificationDto } from "@shilabs/shared-types";
import { AppError } from "../../shared/errors.js";
import { createAIProvider } from "../ai/ai.factory.js";
import type { AIProvider } from "../ai/ai.provider.js";
import type { AuthenticatedUser } from "../auth/auth.types.js";
import { findLeadById } from "../leads/lead.repository.js";
import { assertCanMutateLead } from "../leads/lead.permissions.js";
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
  return toQualificationDto(qualification);
}

export async function recalculateQualification(
  leadId: string,
  provider: AIProvider = createAIProvider()
): Promise<LeadQualificationDto> {
  const lead = await findLeadById(leadId);
  if (!lead) throw new AppError(404, "NOT_FOUND", "Lead not found");

  const messages = (await listRecentMessagesForLead({ leadId, take: RECENT_MESSAGE_LIMIT }))
    .reverse()
    .map((message) => ({ id: message.id, senderType: message.senderType, body: message.body }));
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

  const evidence = await validateEvidence(leadId, extraction.data.evidence);
  const existing = await findQualificationByLeadId(leadId);
  const data = mergeQualification(existing, toMergeableFields(extraction.data));
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
