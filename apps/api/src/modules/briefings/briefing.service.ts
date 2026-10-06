import { BriefingKind, Prisma, UserRole } from "@prisma/client";
import type { BriefingEvidenceReferenceDto, BriefingRunDto } from "@shilabs/shared-types";
import { getAIConfig } from "../../config/ai.js";
import { AppError } from "../../shared/errors.js";
import { prisma } from "../../shared/prisma.js";
import { createAIProvider } from "../ai/ai.factory.js";
import type { AIProvider, BriefingResult } from "../ai/ai.provider.js";
import { briefingResultSchema } from "../ai/ai.schemas.js";
import { sourceContainsGroundedQuote } from "../ai/grounding.js";
import type { AuthenticatedUser } from "../auth/auth.types.js";
import { publishDomainEvent } from "../domain-events/domain-events.service.js";
import { listApprovedKnowledge } from "../knowledge-base/knowledge-base.service.js";
import type { GenerateBriefingInput, ListBriefingsQuery } from "./briefing.schemas.js";

interface BriefingOptions {
  provider?: AIProvider;
  env?: NodeJS.ProcessEnv;
}

interface EvidenceSource {
  id: string;
  sourceType: string;
  title: string;
  text: string;
}

const leadContextInclude = {
  company: true,
  contact: true,
  owner: true,
  stage: true,
  qualification: { include: { evidence: true } },
  deal: { include: { stage: true, owner: true } },
  proposals: {
    include: { currentVersion: true },
    orderBy: { updatedAt: "desc" as const },
    take: 5
  },
  conversations: {
    include: { messages: { orderBy: { createdAt: "desc" as const }, take: 30 } },
    orderBy: { updatedAt: "desc" as const },
    take: 3
  },
  meetingRequests: {
    include: { slots: { orderBy: { startsAt: "asc" as const } } },
    orderBy: { updatedAt: "desc" as const },
    take: 5
  },
  activities: { orderBy: { createdAt: "desc" as const }, take: 12 }
} satisfies Prisma.LeadInclude;

const runInclude = {} satisfies Prisma.BriefingRunInclude;

type LeadContext = Prisma.LeadGetPayload<{ include: typeof leadContextInclude }>;
type BriefingRunRecord = Prisma.BriefingRunGetPayload<{ include: typeof runInclude }>;

function canSeeLead(actor: AuthenticatedUser, lead: { ownerId: string | null }): boolean {
  return (
    actor.role === UserRole.ADMIN ||
    actor.role === UserRole.SALES_MANAGER ||
    lead.ownerId === actor.id ||
    lead.ownerId === null
  );
}

function toJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function trimText(value: string, max = 12000): string {
  return value.length > max ? value.slice(0, max) : value;
}

function source(id: string, sourceType: string, title: string, text: string | null | undefined): EvidenceSource | null {
  const normalized = text?.trim();
  if (!normalized) return null;
  return { id, sourceType, title, text: trimText(normalized) };
}

function providerMetadata(env: NodeJS.ProcessEnv | undefined, provider?: AIProvider): {
  providerName: string;
  model: string;
} {
  if (provider) return { providerName: "test-double", model: "test-double" };
  const config = getAIConfig(env);
  return {
    providerName: config.AI_PROVIDER,
    model: config.AI_PROVIDER === "gemini" ? config.GEMINI_MODEL : config.OPENAI_MODEL
  };
}

function sanitizeError(error: unknown): { code: string; message: string } {
  if (error instanceof AppError) {
    return { code: error.code, message: error.message };
  }
  if (error instanceof Error) {
    return { code: "PROVIDER_ERROR", message: error.message };
  }
  return { code: "PROVIDER_ERROR", message: "Briefing generation failed" };
}

function toEvidenceDto(value: unknown): BriefingEvidenceReferenceDto[] {
  const parsed = Array.isArray(value) ? value : [];
  return parsed
    .filter((item): item is BriefingEvidenceReferenceDto => {
      if (typeof item !== "object" || item === null) return false;
      const record = item as Record<string, unknown>;
      return (
        typeof record.id === "string" &&
        typeof record.sourceType === "string" &&
        typeof record.title === "string" &&
        typeof record.text === "string"
      );
    })
    .slice(0, 100);
}

function toDto(run: BriefingRunRecord): BriefingRunDto {
  return {
    id: run.id,
    kind: run.kind,
    leadId: run.leadId,
    meetingRequestId: run.meetingRequestId,
    actorUserId: run.actorUserId,
    status: run.status,
    provider: run.provider,
    model: run.model,
    inputContext: run.inputContext,
    evidence: toEvidenceDto(run.evidence),
    approvedKnowledge: run.approvedKnowledge,
    output: run.output,
    summary: run.summary,
    recommendedNextAction: run.recommendedNextAction,
    failureCode: run.failureCode,
    failureMessage: run.failureMessage,
    idempotencyKey: run.idempotencyKey,
    createdAt: run.createdAt.toISOString(),
    updatedAt: run.updatedAt.toISOString()
  };
}

function validateGrounding(input: {
  output: BriefingResult;
  sources: EvidenceSource[];
  approvedKnowledgeIds: Set<string>;
}): void {
  const sourceTexts = new Map(input.sources.map((item) => [item.id, item.text] as const));
  for (const id of input.output.usedKnowledgeIds) {
    if (!input.approvedKnowledgeIds.has(id)) {
      throw new AppError(502, "PROVIDER_ERROR", "AI briefing referenced unapproved knowledge");
    }
  }
  for (const evidence of input.output.evidence) {
    if (!sourceContainsGroundedQuote(sourceTexts.get(evidence.sourceId), evidence.quote)) {
      throw new AppError(502, "PROVIDER_ERROR", "AI briefing evidence was not grounded");
    }
  }
}

function leadSummarySource(lead: LeadContext): EvidenceSource {
  return {
    id: `lead:${lead.id}`,
    sourceType: "LEAD",
    title: "Lead facts",
    text: trimText(
      JSON.stringify({
        company: lead.company.name,
        contact: `${lead.contact.firstName} ${lead.contact.lastName}`.trim(),
        email: lead.contact.email,
        phoneKnown: Boolean(lead.contact.normalizedPhone),
        source: lead.source,
        status: lead.status,
        stage: lead.stage.label,
        requirement: lead.requirement,
        serviceInterest: lead.serviceInterest,
        score: lead.score,
        temperature: lead.temperature,
        estimatedValue: lead.estimatedValue?.toString() ?? null,
        currency: lead.currency,
        nextAction: lead.nextAction,
        nextActionAt: lead.nextActionAt?.toISOString() ?? null
      })
    )
  };
}

function buildContext(input: {
  lead: LeadContext;
  meetingRequestId?: string | null;
}): { inputContext: Prisma.InputJsonObject; sources: EvidenceSource[] } {
  const lead = input.lead;
  const meeting = input.meetingRequestId
    ? (lead.meetingRequests.find((request) => request.id === input.meetingRequestId) ?? null)
    : null;
  const sources: EvidenceSource[] = [leadSummarySource(lead)];

  if (lead.qualification) {
    const qualificationSource = source(
      `qualification:${lead.qualification.id}`,
      "QUALIFICATION",
      "Lead qualification",
      JSON.stringify({
        need: lead.qualification.need,
        requirement: lead.qualification.requirement,
        budget: lead.qualification.budget,
        budgetBand: lead.qualification.budgetBand,
        authority: lead.qualification.authority,
        timeline: lead.qualification.timeline,
        businessFit: lead.qualification.businessFit,
        decisionMakerIdentified: lead.qualification.decisionMakerIdentified,
        urgency: lead.qualification.urgency
      })
    );
    if (qualificationSource) sources.push(qualificationSource);
  }

  for (const conversation of lead.conversations) {
    for (const message of [...conversation.messages].reverse()) {
      const messageSource = source(
        `message:${message.id}`,
        "MESSAGE",
        `${message.direction} ${message.senderType} message`,
        message.body
      );
      if (messageSource) sources.push(messageSource);
    }
  }

  for (const proposal of lead.proposals) {
    const proposalSource = source(
      `proposal:${proposal.id}`,
      "PROPOSAL",
      proposal.title,
      JSON.stringify({
        title: proposal.title,
        serviceType: proposal.serviceType,
        status: proposal.status,
        currentVersion: proposal.currentVersion
          ? {
              title: proposal.currentVersion.title,
              content: proposal.currentVersion.content
            }
          : null
      })
    );
    if (proposalSource) sources.push(proposalSource);
  }

  if (lead.deal) {
    const dealSource = source(
      `deal:${lead.deal.id}`,
      "DEAL",
      "Deal context",
      JSON.stringify({
        value: lead.deal.value?.toString() ?? null,
        currency: lead.deal.currency,
        probability: lead.deal.probability,
        status: lead.deal.status,
        stage: lead.deal.stage.label,
        proposalStatus: lead.deal.proposalStatus,
        wonReason: lead.deal.wonReason,
        lostReason: lead.deal.lostReason
      })
    );
    if (dealSource) sources.push(dealSource);
  }

  for (const request of lead.meetingRequests) {
    const meetingSource = source(
      `meeting:${request.id}`,
      "MEETING",
      request.title,
      JSON.stringify({
        status: request.status,
        title: request.title,
        timeZone: request.timeZone,
        durationMinutes: request.durationMinutes,
        windowStart: request.windowStart.toISOString(),
        windowEnd: request.windowEnd.toISOString(),
        confirmedAt: request.confirmedAt?.toISOString() ?? null,
        providerSyncStatus: request.providerSyncStatus,
        selectedSlotId: request.selectedSlotId,
        slots: request.slots.map((slot) => ({
          id: slot.id,
          startsAt: slot.startsAt.toISOString(),
          endsAt: slot.endsAt.toISOString(),
          status: slot.status
        }))
      })
    );
    if (meetingSource) sources.push(meetingSource);
  }

  for (const activity of lead.activities) {
    const activitySource = source(
      `activity:${activity.id}`,
      "ACTIVITY",
      activity.type,
      `${activity.createdAt.toISOString()} ${activity.type}: ${activity.description}`
    );
    if (activitySource) sources.push(activitySource);
  }

  const inputContext = {
    leadId: lead.id,
    meetingRequestId: meeting?.id ?? null,
    lead: {
      company: lead.company.name,
      contact: `${lead.contact.firstName} ${lead.contact.lastName}`.trim(),
      status: lead.status,
      stage: lead.stage.label,
      requirement: lead.requirement,
      serviceInterest: lead.serviceInterest,
      score: lead.score,
      temperature: lead.temperature,
      nextAction: lead.nextAction,
      nextActionAt: lead.nextActionAt?.toISOString() ?? null
    },
    unknownPolicy: "Unknown data must stay unknown/null. Briefing is advisory only.",
    availableSourceIds: sources.map((item) => item.id)
  } satisfies Prisma.InputJsonObject;

  return { inputContext, sources };
}

async function loadLeadContextOrThrow(actor: AuthenticatedUser, leadId: string): Promise<LeadContext> {
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    include: leadContextInclude
  });
  if (!lead) throw new AppError(404, "NOT_FOUND", "Lead not found");
  if (!canSeeLead(actor, lead)) {
    throw new AppError(403, "AUTHORIZATION_ERROR", "Cannot access this lead briefing");
  }
  return lead;
}

async function createRun(input: {
  actor: AuthenticatedUser;
  kind: BriefingKind;
  leadId: string;
  meetingRequestId?: string | null;
  status: "COMPLETED" | "FAILED";
  provider?: string | null;
  model?: string | null;
  inputContext: Prisma.InputJsonValue;
  sources: EvidenceSource[];
  approvedKnowledge?: Prisma.InputJsonValue;
  output?: BriefingResult | null;
  failureCode?: string | null;
  failureMessage?: string | null;
  idempotencyKey: string;
}): Promise<BriefingRunRecord> {
  return prisma.$transaction(
    async (tx) => {
      const created = await tx.briefingRun.create({
        data: {
          kind: input.kind,
          leadId: input.leadId,
          meetingRequestId: input.meetingRequestId ?? null,
          actorUserId: input.actor.id,
          status: input.status,
          provider: input.provider ?? null,
          model: input.model ?? null,
          inputContext: input.inputContext,
          evidence: toJson(input.sources),
          approvedKnowledge: input.approvedKnowledge,
          output: input.output ? toJson(input.output) : undefined,
          summary: input.output?.summary ?? null,
          recommendedNextAction: input.output?.recommendedNextAction ?? null,
          failureCode: input.failureCode ?? null,
          failureMessage: input.failureMessage ?? null,
          idempotencyKey: input.idempotencyKey
        }
      });
      await tx.auditEvent.create({
        data: {
          actorType: "USER",
          actorId: input.actor.id,
          entityType: "BriefingRun",
          entityId: created.id,
          action: input.status === "COMPLETED" ? "BRIEFING_GENERATED" : "BRIEFING_FAILED",
          after: {
            kind: input.kind,
            leadId: input.leadId,
            meetingRequestId: input.meetingRequestId ?? null,
            status: input.status,
            advisoryOnly: true,
            noExternalActions: true
          }
        }
      });
      if (input.status === "COMPLETED") {
        await tx.activity.create({
          data: {
            leadId: input.leadId,
            actorUserId: input.actor.id,
            type: "BRIEFING_GENERATED",
            description:
              input.kind === "MEETING"
                ? "Advisory meeting briefing generated"
                : "Advisory lead briefing generated"
          }
        });
      }
      await publishDomainEvent({
        client: tx,
        eventType: input.status === "COMPLETED" ? "BRIEFING_GENERATED" : "BRIEFING_FAILED",
        aggregateType: "BriefingRun",
        aggregateId: created.id,
        correlationId: input.meetingRequestId ?? input.leadId,
        idempotencyKey: `domain-event:briefing:${created.id}`,
        maxAttempts: 1,
        payload: {
          leadId: input.leadId,
          meetingRequestId: input.meetingRequestId ?? null,
          kind: input.kind,
          status: input.status,
          advisoryOnly: true
        }
      });
      return created;
    },
    { maxWait: 10000, timeout: 30000 }
  );
}

async function generateBriefing(input: {
  actor: AuthenticatedUser;
  kind: BriefingKind;
  lead: LeadContext;
  meetingRequestId?: string | null;
  idempotencyKey: string;
  options?: BriefingOptions;
}): Promise<BriefingRunDto> {
  const existing = await prisma.briefingRun.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
    include: runInclude
  });
  if (existing) return toDto(existing);

  const { inputContext, sources } = buildContext({
    lead: input.lead,
    meetingRequestId: input.meetingRequestId
  });
  const knowledge = await listApprovedKnowledge({ limit: 30 });
  const knowledgeSources = knowledge.map((item) => ({
    id: item.versionId,
    sourceType: "APPROVED_KB",
    title: item.title,
    text: item.content
  }));
  const allSources = [...sources, ...knowledgeSources];

  let metadata: { providerName: string; model: string } | null = null;
  try {
    metadata = providerMetadata(input.options?.env, input.options?.provider);
    const provider = input.options?.provider ?? createAIProvider(input.options?.env);
    const rawOutput = await provider.generateBriefing({
      messages: allSources.slice(0, 100).map((item) => ({
        id: item.id,
        senderType: "SYSTEM",
        body: item.text
      })),
      approvedKnowledge: knowledge.map((item) => ({ id: item.versionId, content: item.content })),
      leadContext: JSON.stringify(inputContext)
    });
    const output = briefingResultSchema.parse(rawOutput);
    validateGrounding({
      output,
      sources: allSources,
      approvedKnowledgeIds: new Set(knowledge.map((item) => item.versionId))
    });
    return toDto(
      await createRun({
        actor: input.actor,
        kind: input.kind,
        leadId: input.lead.id,
        meetingRequestId: input.meetingRequestId,
        status: "COMPLETED",
        provider: metadata.providerName,
        model: metadata.model,
        inputContext,
        sources: allSources,
        approvedKnowledge: toJson(
          knowledge.map((item) => ({
            id: item.versionId,
            key: item.key,
            title: item.title,
            category: item.category,
            sourceTitle: item.sourceTitle
          }))
        ),
        output,
        idempotencyKey: input.idempotencyKey
      })
    );
  } catch (error) {
    const sanitized = sanitizeError(error);
    return toDto(
      await createRun({
        actor: input.actor,
        kind: input.kind,
        leadId: input.lead.id,
        meetingRequestId: input.meetingRequestId,
        status: "FAILED",
        provider: metadata?.providerName ?? null,
        model: metadata?.model ?? null,
        inputContext,
        sources: allSources,
        approvedKnowledge: toJson(
          knowledge.map((item) => ({
            id: item.versionId,
            key: item.key,
            title: item.title,
            category: item.category,
            sourceTitle: item.sourceTitle
          }))
        ),
        failureCode: sanitized.code,
        failureMessage: sanitized.message,
        idempotencyKey: input.idempotencyKey
      })
    );
  }
}

export async function generateLeadBriefing(
  actor: AuthenticatedUser,
  leadId: string,
  body: GenerateBriefingInput,
  options?: BriefingOptions
): Promise<BriefingRunDto> {
  const lead = await loadLeadContextOrThrow(actor, leadId);
  const idempotencyKey =
    body.idempotencyKey ?? `briefing:lead:${leadId}:actor:${actor.id}:${new Date().toISOString()}`;
  return generateBriefing({
    actor,
    kind: "LEAD",
    lead,
    idempotencyKey,
    options
  });
}

export async function generateMeetingBriefing(
  actor: AuthenticatedUser,
  meetingRequestId: string,
  body: GenerateBriefingInput,
  options?: BriefingOptions
): Promise<BriefingRunDto> {
  const request = await prisma.meetingRequest.findUnique({
    where: { id: meetingRequestId },
    select: { id: true, leadId: true }
  });
  if (!request) throw new AppError(404, "NOT_FOUND", "Meeting request not found");
  const lead = await loadLeadContextOrThrow(actor, request.leadId);
  if (!lead.meetingRequests.some((meeting) => meeting.id === meetingRequestId)) {
    throw new AppError(409, "CONFLICT", "Meeting request is not in briefing context");
  }
  const idempotencyKey =
    body.idempotencyKey ??
    `briefing:meeting:${meetingRequestId}:actor:${actor.id}:${new Date().toISOString()}`;
  return generateBriefing({
    actor,
    kind: "MEETING",
    lead,
    meetingRequestId,
    idempotencyKey,
    options
  });
}

export async function listBriefings(
  actor: AuthenticatedUser,
  query: ListBriefingsQuery
): Promise<BriefingRunDto[]> {
  const runs = await prisma.briefingRun.findMany({
    where: {
      leadId: query.leadId,
      meetingRequestId: query.meetingRequestId,
      kind: query.kind,
      status: query.status,
      lead:
        actor.role === UserRole.ADMIN || actor.role === UserRole.SALES_MANAGER
          ? undefined
          : { OR: [{ ownerId: actor.id }, { ownerId: null }] }
    },
    include: runInclude,
    orderBy: [{ createdAt: "desc" }],
    take: query.limit
  });
  return runs.map(toDto);
}
