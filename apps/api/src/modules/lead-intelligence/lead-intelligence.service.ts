import { createHash, randomUUID } from "node:crypto";
import {
  LeadAiControlStatus,
  LeadIntelligenceDecisionType,
  UserRole,
  type Prisma
} from "@prisma/client";
import type {
  AiCommandCenterDto,
  IntelligenceEvidenceDto,
  LeadDocumentDto,
  LeadIntelligenceDecisionDto,
  LeadIntelligenceDto
} from "@shilabs/shared-types";
import { AppError } from "../../shared/errors.js";
import { prisma } from "../../shared/prisma.js";
import type { AuthenticatedUser } from "../auth/auth.types.js";
import {
  completeHumanAction,
  isTerminalLeadStatus,
  requireHumanAction,
  stopAi
} from "../leads/lead-automation-ownership.service.js";
import { assertCanAccessLead, leadVisibilityWhere } from "../leads/lead.permissions.js";
import { publishRealtimeEvent } from "../realtime/realtime.service.js";
import type {
  CreateLeadDocumentInput,
  UpdateLeadIntelligenceControlsInput
} from "./lead-intelligence.schemas.js";

const HIGH_RISK_PATTERN =
  /\b(complaint|legal|lawyer|refund|cancel|angry|confidential|contract|discount|negotiat|pricing|price|custom terms?)\b/i;
const OBJECTION_PATTERN =
  /\b(expensive|budget|price|pricing|cost|competitor|concern|objection|not ready|too high)\b/i;
const COMMITMENT_PATTERN =
  /\b(i will|we will|i'll|we'll|send you|share with|come back|follow up|by (monday|tuesday|wednesday|thursday|friday|tomorrow|next week))\b/i;
const DAY_MS = 86_400_000;

const contextInclude = {
  company: true,
  contact: true,
  owner: true,
  stage: true,
  deal: { include: { stage: true } },
  qualification: true,
  conversations: {
    include: { messages: { orderBy: { createdAt: "desc" as const }, take: 30 } },
    orderBy: { lastMessageAt: "desc" as const }
  },
  activities: {
    where: {
      visibility: "BUSINESS" as const,
      type: {
        notIn: [
          "LEAD_INTELLIGENCE_UPDATED",
          "LEAD_AI_CONTROL_UPDATED",
          "LEAD_DOCUMENT_INDEXED",
          "FOLLOW_UP_DECISION_RECORDED"
        ]
      }
    },
    orderBy: { occurredAt: "desc" as const },
    take: 40
  },
  tasks: { orderBy: { createdAt: "desc" as const }, take: 30 },
  proposals: {
    include: { currentVersion: true },
    orderBy: { updatedAt: "desc" as const },
    take: 10
  },
  meetingRequests: { orderBy: { createdAt: "desc" as const }, take: 10 },
  followUpAttempts: { orderBy: { createdAt: "desc" as const }, take: 30 },
  intelligenceDocuments: {
    where: { status: "INDEXED" as const },
    include: { chunks: { orderBy: { position: "asc" as const }, take: 20 } },
    orderBy: { indexedAt: "desc" as const }
  }
} satisfies Prisma.LeadInclude;

type IntelligenceRecordBase = Prisma.LeadIntelligenceGetPayload<Record<string, never>>;
type IntelligenceDecisionRecord = Prisma.LeadIntelligenceDecisionGetPayload<Record<string, never>>;
type IntelligenceDocumentRecord = Prisma.LeadDocumentGetPayload<{
  include: { _count: { select: { chunks: true } } };
}>;
type IntelligenceRecord = IntelligenceRecordBase & {
  documents: IntelligenceDocumentRecord[];
  latestDecision: IntelligenceDecisionRecord | null;
};
type LeadContext = Prisma.LeadGetPayload<{ include: typeof contextInclude }>;

function workspaceIdOrThrow(actor: AuthenticatedUser): string {
  if (!actor.activeWorkspaceId)
    throw new AppError(409, "CONFLICT", "An active workspace is required");
  return actor.activeWorkspaceId;
}

async function loadLead(
  actor: AuthenticatedUser,
  leadId: string
): Promise<LeadContext & { workspaceId: string }> {
  const lead = await prisma.lead.findFirst({
    where: { AND: [{ id: leadId }, leadVisibilityWhere(actor)] },
    include: contextInclude
  });
  if (!lead) throw new AppError(404, "NOT_FOUND", "Lead not found");
  assertCanAccessLead(actor, lead);
  if (!lead.workspaceId) throw new AppError(409, "CONFLICT", "Lead has no persisted workspace");
  return { ...lead, workspaceId: lead.workspaceId };
}

function clip(value: string, length = 420): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= length) return normalized;
  return `${normalized.slice(0, Math.max(0, length - 3)).trimEnd()}...`;
}

function latestContextChangeAt(lead: LeadContext): Date {
  const timestamps = [
    lead.updatedAt,
    lead.company.updatedAt,
    lead.contact.updatedAt,
    lead.deal?.updatedAt,
    lead.qualification?.updatedAt,
    ...lead.activities.map((item) => item.createdAt),
    ...lead.tasks.map((item) => item.updatedAt),
    ...lead.proposals.map((item) => item.updatedAt),
    ...lead.meetingRequests.map((item) => item.updatedAt),
    ...lead.followUpAttempts.map((item) => item.updatedAt),
    ...lead.intelligenceDocuments.map((item) => item.updatedAt),
    ...lead.conversations.flatMap((conversation) => [
      conversation.updatedAt,
      ...conversation.messages.map((message) => message.createdAt)
    ])
  ].filter((value): value is Date => value instanceof Date);
  return new Date(Math.max(...timestamps.map((value) => value.getTime())));
}

function evidence(
  sourceId: string,
  sourceType: string,
  title: string,
  quote: string,
  occurredAt?: Date | null
): IntelligenceEvidenceDto {
  return {
    sourceId,
    sourceType,
    title,
    quote: clip(quote),
    occurredAt: occurredAt?.toISOString() ?? null
  };
}

function documentDto(document: IntelligenceDocumentRecord): LeadDocumentDto {
  return {
    id: document.id,
    leadId: document.leadId,
    title: document.title,
    kind: document.kind,
    sourceType: document.sourceType,
    sourceUrl: document.sourceUrl,
    mimeType: document.mimeType,
    status: document.status,
    extractedText: document.extractedText,
    failureMessage: document.failureMessage,
    indexedAt: document.indexedAt?.toISOString() ?? null,
    chunkCount: document._count.chunks,
    createdAt: document.createdAt.toISOString(),
    updatedAt: document.updatedAt.toISOString()
  };
}

function decisionDto(decision: IntelligenceDecisionRecord): LeadIntelligenceDecisionDto {
  return {
    id: decision.id,
    leadId: decision.leadId,
    decision: decision.decision,
    reason: decision.reason,
    nextObjective: decision.nextObjective,
    factors: decision.factors,
    evidence: decision.evidence as unknown as IntelligenceEvidenceDto[],
    guardrailCode: decision.guardrailCode,
    correlationId: decision.correlationId,
    createdAt: decision.createdAt.toISOString()
  };
}

function intelligenceDto(record: IntelligenceRecord): LeadIntelligenceDto {
  return {
    id: record.id,
    leadId: record.leadId,
    summary: record.summary,
    primaryNeed: record.primaryNeed,
    objections: record.objections,
    commitments: record.commitments,
    nextObjective: record.nextObjective,
    communicationStyle: record.communicationStyle,
    healthScore: record.healthScore,
    aiControlStatus: record.aiControlStatus,
    followUpMode: record.followUpMode,
    humanInterventionRequired: record.humanInterventionRequired,
    preferredChannel: record.preferredChannel,
    customCadenceDays: record.customCadenceDays,
    contextSnapshot: record.contextSnapshot,
    evidence: record.evidence as unknown as IntelligenceEvidenceDto[],
    lastRefreshedAt: record.lastRefreshedAt.toISOString(),
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    documents: record.documents.map(documentDto),
    latestDecision: record.latestDecision ? decisionDto(record.latestDecision) : null
  };
}

function messages(lead: LeadContext) {
  return lead.conversations.flatMap((conversation) => conversation.messages);
}

function deriveMemory(lead: LeadContext): {
  summary: string;
  primaryNeed: string | null;
  objections: string[];
  commitments: string[];
  nextObjective: string | null;
  communicationStyle: string;
  healthScore: number;
  snapshot: Prisma.InputJsonObject;
  sources: IntelligenceEvidenceDto[];
} {
  const allMessages = messages(lead).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const inbound = allMessages.filter((item) => item.direction === "INBOUND");
  const outbound = allMessages.filter((item) => item.direction === "OUTBOUND");
  const objections = inbound.filter((item) => OBJECTION_PATTERN.test(item.body)).slice(0, 5);
  const commitments = outbound.filter((item) => COMMITMENT_PATTERN.test(item.body)).slice(0, 5);
  const documentSources = lead.intelligenceDocuments.flatMap((document) =>
    document.chunks
      .slice(0, 3)
      .map((chunk) =>
        evidence(
          `document-chunk:${chunk.id}`,
          "DOCUMENT",
          document.title,
          chunk.content,
          document.indexedAt
        )
      )
  );
  const communicationSources = allMessages
    .slice(0, 12)
    .map((message) =>
      evidence(
        `message:${message.id}`,
        "MESSAGE",
        `${message.direction} communication`,
        message.body,
        message.createdAt
      )
    );
  const activitySources = lead.activities
    .slice(0, 8)
    .map((activity) =>
      evidence(
        `activity:${activity.id}`,
        "ACTIVITY",
        activity.title ?? activity.type,
        activity.description,
        activity.occurredAt
      )
    );
  const primaryNeed = lead.qualification?.need ?? lead.requirement ?? lead.serviceInterest;
  const nextObjective =
    lead.nextAction ??
    (lead.meetingRequests.some((item) => item.status === "CONFIRMATION_REQUIRED")
      ? "Confirm the proposed meeting time"
      : lead.proposals.some((item) => item.status === "WAITING_APPROVAL")
        ? "Review the pending proposal"
        : "Clarify the next substantive sales objective");
  const latestInbound = inbound[0];
  const communicationStyle =
    latestInbound && latestInbound.body.split(/\s+/).length <= 24
      ? "Concise and professional"
      : "Detailed and professional";
  const recencyDays = lead.lastActivityAt
    ? Math.max(0, Math.floor((Date.now() - lead.lastActivityAt.getTime()) / DAY_MS))
    : 30;
  const healthScore = Math.max(
    0,
    Math.min(
      100,
      lead.score +
        (lead.temperature === "HOT" ? 10 : lead.temperature === "WARM" ? 5 : 0) +
        (lead.deal?.probability ? Math.round(lead.deal.probability / 10) : 0) -
        Math.min(20, recencyDays) -
        (lead.automationOwnershipState === "HUMAN_REQUIRED" ? 10 : 0)
    )
  );
  const summary = `${lead.company.name}: ${primaryNeed ?? "need not yet established"}. Stage ${lead.stage.label}; ${lead.automationOwnershipState.replaceAll("_", " ").toLowerCase()}.`;
  const latestCommunicationAt = allMessages[0]?.createdAt ?? lead.lastActivityAt;
  return {
    summary,
    primaryNeed,
    objections: objections.map((item) => clip(item.body, 220)),
    commitments: commitments.map((item) => clip(item.body, 220)),
    nextObjective,
    communicationStyle,
    healthScore,
    snapshot: {
      lead: {
        status: lead.status,
        stage: lead.stage.label,
        score: lead.score,
        temperature: lead.temperature,
        source: lead.source,
        serviceInterest: lead.serviceInterest,
        ownershipState: lead.automationOwnershipState
      },
      company: {
        name: lead.company.name,
        website: lead.company.website,
        industry: lead.company.industry,
        location: lead.company.location,
        employeeRange: lead.company.employeeRange
      },
      commercial: {
        estimatedValue: lead.estimatedValue?.toString() ?? null,
        currency: lead.currency,
        dealValue: lead.deal?.value?.toString() ?? null,
        dealProbability: lead.deal?.probability ?? null,
        proposalCount: lead.proposals.length
      },
      counts: {
        communications: allMessages.length,
        activities: lead.activities.length,
        tasks: lead.tasks.length,
        meetings: lead.meetingRequests.length,
        documents: lead.intelligenceDocuments.length,
        followUps: lead.followUpAttempts.length
      },
      latestCommunicationAt: latestCommunicationAt?.toISOString() ?? null
    },
    sources: [...communicationSources, ...documentSources, ...activitySources].slice(0, 40)
  };
}

async function loadRecord(leadId: string): Promise<IntelligenceRecord> {
  const [record, documents, latestDecision] = await Promise.all([
    prisma.leadIntelligence.findUniqueOrThrow({ where: { leadId } }),
    prisma.leadDocument.findMany({
      where: { leadId },
      include: { _count: { select: { chunks: true } } },
      orderBy: { createdAt: "desc" }
    }),
    prisma.leadIntelligenceDecision.findFirst({ where: { leadId }, orderBy: { createdAt: "desc" } })
  ]);
  return { ...record, documents, latestDecision };
}

export async function refreshLeadIntelligence(
  actor: AuthenticatedUser,
  leadId: string
): Promise<LeadIntelligenceDto> {
  const lead = await loadLead(actor, leadId);
  const memory = deriveMemory(lead);
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.leadIntelligence.upsert({
      where: { leadId },
      create: {
        workspaceId: lead.workspaceId,
        leadId,
        summary: memory.summary,
        primaryNeed: memory.primaryNeed,
        objections: memory.objections,
        commitments: memory.commitments,
        nextObjective: memory.nextObjective,
        communicationStyle: memory.communicationStyle,
        healthScore: memory.healthScore,
        customCadenceDays: [],
        contextSnapshot: memory.snapshot,
        evidence: memory.sources as unknown as Prisma.InputJsonValue,
        lastRefreshedAt: now
      },
      update: {
        summary: memory.summary,
        primaryNeed: memory.primaryNeed,
        objections: memory.objections,
        commitments: memory.commitments,
        nextObjective: memory.nextObjective,
        communicationStyle: memory.communicationStyle,
        healthScore: memory.healthScore,
        contextSnapshot: memory.snapshot,
        evidence: memory.sources as unknown as Prisma.InputJsonValue,
        lastRefreshedAt: now
      }
    });
    await tx.activity.create({
      data: {
        workspaceId: lead.workspaceId,
        leadId,
        actorType: "USER",
        actorUserId: actor.id,
        sourceType: "LEAD_INTELLIGENCE",
        sourceId: leadId,
        type: "LEAD_INTELLIGENCE_UPDATED",
        title: "Lead intelligence refreshed",
        description: "Lead memory was refreshed from grounded CRM evidence.",
        metadata: { healthScore: memory.healthScore, evidenceCount: memory.sources.length },
        visibility: "BUSINESS"
      }
    });
    await tx.auditEvent.create({
      data: {
        workspaceId: lead.workspaceId,
        actorType: "USER",
        actorId: actor.id,
        actorUserId: actor.id,
        sourceType: "LEAD_INTELLIGENCE",
        sourceId: leadId,
        entityType: "LeadIntelligence",
        entityId: leadId,
        action: "LEAD_INTELLIGENCE_REFRESHED",
        after: { healthScore: memory.healthScore, evidenceCount: memory.sources.length }
      }
    });
  });
  await publishRealtimeEvent({ entityType: "lead", action: "lead-intelligence-updated", leadId });
  return intelligenceDto(await loadRecord(leadId));
}

export async function getLeadIntelligence(
  actor: AuthenticatedUser,
  leadId: string
): Promise<LeadIntelligenceDto> {
  const lead = await loadLead(actor, leadId);
  const current = await prisma.leadIntelligence.findUnique({ where: { leadId } });
  if (!current || current.lastRefreshedAt < latestContextChangeAt(lead)) {
    return refreshLeadIntelligence(actor, leadId);
  }
  return intelligenceDto(await loadRecord(leadId));
}

export async function updateLeadIntelligenceControls(
  actor: AuthenticatedUser,
  leadId: string,
  input: UpdateLeadIntelligenceControlsInput
): Promise<LeadIntelligenceDto> {
  const lead = await loadLead(actor, leadId);
  const current = await getLeadIntelligence(actor, leadId);
  if (
    input.followUpMode === "CUSTOM" &&
    !(input.customCadenceDays?.length ?? current.customCadenceDays.length)
  ) {
    throw new AppError(400, "VALIDATION_ERROR", "Custom follow-up mode requires cadence days");
  }
  await prisma.$transaction(async (tx) => {
    await tx.leadIntelligence.update({
      where: { leadId },
      data: {
        aiControlStatus: input.aiControlStatus,
        followUpMode: input.followUpMode,
        humanInterventionRequired: input.humanInterventionRequired,
        preferredChannel: input.preferredChannel,
        customCadenceDays: input.customCadenceDays
      }
    });
    await tx.activity.create({
      data: {
        workspaceId: lead.workspaceId,
        leadId,
        actorType: "USER",
        actorUserId: actor.id,
        sourceType: "LEAD_AI_CONTROLS",
        sourceId: leadId,
        type: "LEAD_AI_CONTROL_UPDATED",
        title: "Lead AI controls updated",
        description: "Lead-level AI controls were updated by an authorized manager.",
        metadata: input,
        visibility: "BUSINESS"
      }
    });
    await tx.auditEvent.create({
      data: {
        workspaceId: lead.workspaceId,
        actorType: "USER",
        actorId: actor.id,
        actorUserId: actor.id,
        sourceType: "LEAD_AI_CONTROLS",
        sourceId: leadId,
        entityType: "LeadIntelligence",
        entityId: leadId,
        action: "LEAD_AI_CONTROLS_UPDATED",
        before: {
          aiControlStatus: current.aiControlStatus,
          followUpMode: current.followUpMode,
          humanInterventionRequired: current.humanInterventionRequired,
          preferredChannel: current.preferredChannel,
          customCadenceDays: current.customCadenceDays
        },
        after: input
      }
    });
  });

  if (input.humanInterventionRequired === true) {
    await requireHumanAction({
      leadId,
      reason: "LEAD_AI_CONTROL_REQUIRES_HUMAN",
      actorType: "USER",
      actorId: actor.id,
      sourceType: "LEAD_AI_CONTROLS",
      sourceId: leadId
    });
  } else if (input.aiControlStatus === "OFF" || input.aiControlStatus === "PAUSED") {
    await stopAi({
      leadId,
      reason: input.aiControlStatus === "OFF" ? "LEAD_AI_DISABLED" : "LEAD_AI_PAUSED",
      actorType: "USER",
      actorId: actor.id,
      sourceType: "LEAD_AI_CONTROLS",
      sourceId: leadId
    });
  } else if (
    input.aiControlStatus === "ON" &&
    (current.aiControlStatus === "OFF" || current.aiControlStatus === "PAUSED") &&
    lead.automationOwnershipState === "AI_STOPPED" &&
    !current.humanInterventionRequired
  ) {
    await completeHumanAction({
      leadId,
      reason: "LEAD_AI_RESUMED",
      actorType: "USER",
      actorId: actor.id,
      sourceType: "LEAD_AI_CONTROLS",
      sourceId: leadId,
      allowStoppedResume: true
    });
  }
  await publishRealtimeEvent({ entityType: "lead", action: "lead-ai-controls-updated", leadId });
  return intelligenceDto(await loadRecord(leadId));
}

function cadenceDays(mode: string, custom: number[]): number {
  if (mode === "AGGRESSIVE") return 1;
  if (mode === "LOW_FREQUENCY") return 7;
  if (mode === "HIGH_VALUE") return 2;
  if (mode === "CUSTOM") return custom[0] ?? 3;
  return 3;
}

export async function decideLeadFollowUp(
  actor: AuthenticatedUser,
  leadId: string
): Promise<LeadIntelligenceDecisionDto> {
  const lead = await loadLead(actor, leadId);
  const intelligence = await getLeadIntelligence(actor, leadId);
  const allMessages = messages(lead).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const latestInbound = allMessages.find((item) => item.direction === "INBOUND") ?? null;
  const latestCommunicationAt = allMessages[0]?.createdAt ?? lead.lastActivityAt;
  const ageDays = latestCommunicationAt
    ? (Date.now() - latestCommunicationAt.getTime()) / DAY_MS
    : 999;
  const highRisk = latestInbound ? HIGH_RISK_PATTERN.test(latestInbound.body) : false;
  let decision: LeadIntelligenceDecisionType = "WAIT";
  let reason = "The configured follow-up interval has not elapsed.";
  let guardrailCode: string | null = null;

  if (lead.contact.doNotContact || isTerminalLeadStatus(lead.status)) {
    decision = "STOP";
    reason = lead.contact.doNotContact
      ? "Contact is marked do not contact."
      : `Lead is ${lead.status.toLowerCase()}.`;
    guardrailCode = lead.contact.doNotContact ? "DO_NOT_CONTACT" : `TERMINAL_${lead.status}`;
  } else if (intelligence.aiControlStatus === "OFF") {
    decision = "STOP";
    reason = "Lead-level AI is switched off.";
    guardrailCode = "AI_CONTROL_OFF";
  } else if (intelligence.aiControlStatus === "PAUSED") {
    decision = "WAIT";
    reason = "Lead-level AI is paused.";
    guardrailCode = "AI_CONTROL_PAUSED";
  } else if (highRisk) {
    decision = "ESCALATE";
    reason =
      "Latest client communication contains pricing, negotiation, legal, complaint, cancellation, or other high-risk language.";
    guardrailCode = "HIGH_RISK_CLIENT_CONTEXT";
  } else if (
    intelligence.humanInterventionRequired ||
    lead.automationOwnershipState === "HUMAN_REQUIRED"
  ) {
    decision = "ASK_HUMAN";
    reason = "Central ownership or lead controls require human intervention.";
    guardrailCode = "HUMAN_REQUIRED";
  } else if (lead.automationOwnershipState !== "AI_ACTIVE") {
    decision = "WAIT";
    reason = `Central ownership is ${lead.automationOwnershipState}; autonomous follow-up is not allowed.`;
    guardrailCode = "OWNERSHIP_BLOCKED";
  } else if (lead.nextActionAt && lead.nextActionAt.getTime() > Date.now()) {
    decision = "WAIT";
    reason = "A promised or scheduled next-action date is still in the future.";
  } else if (ageDays >= cadenceDays(intelligence.followUpMode, intelligence.customCadenceDays)) {
    decision = "FOLLOW_UP";
    reason =
      "AI ownership is active and the configured evidence-based follow-up interval has elapsed.";
  }

  const selectedEvidence = [
    ...(latestInbound
      ? [
          evidence(
            `message:${latestInbound.id}`,
            "MESSAGE",
            "Latest inbound communication",
            latestInbound.body,
            latestInbound.createdAt
          )
        ]
      : []),
    ...intelligence.evidence.slice(0, 5)
  ].slice(0, 6);
  const correlationId = `lead-intelligence:${leadId}:${randomUUID()}`;
  const created = await prisma.$transaction(async (tx) => {
    const result = await tx.leadIntelligenceDecision.create({
      data: {
        workspaceId: lead.workspaceId,
        leadId,
        decision,
        reason,
        nextObjective: intelligence.nextObjective,
        factors: {
          ownershipState: lead.automationOwnershipState,
          aiControlStatus: intelligence.aiControlStatus,
          followUpMode: intelligence.followUpMode,
          followUpCount: lead.followUpAttempts.length,
          leadScore: lead.score,
          dealValue: lead.deal?.value?.toString() ?? null,
          dealStage: lead.deal?.stage.label ?? lead.stage.label,
          lastCommunicationAt: latestCommunicationAt?.toISOString() ?? null,
          ageDays: Math.round(ageDays * 10) / 10
        },
        evidence: selectedEvidence as unknown as Prisma.InputJsonValue,
        guardrailCode,
        correlationId
      }
    });
    await tx.activity.create({
      data: {
        workspaceId: lead.workspaceId,
        leadId,
        actorType: "SYSTEM",
        sourceType: "LEAD_INTELLIGENCE_DECISION",
        sourceId: result.id,
        type: "FOLLOW_UP_DECISION_RECORDED",
        title: `AI recommendation: ${decision.replaceAll("_", " ")}`,
        description: reason,
        metadata: { decision, guardrailCode, advisoryOnly: true },
        correlationId,
        visibility: "BUSINESS"
      }
    });
    await tx.auditEvent.create({
      data: {
        workspaceId: lead.workspaceId,
        actorType: "SYSTEM",
        sourceType: "LEAD_INTELLIGENCE_DECISION",
        sourceId: result.id,
        entityType: "LeadIntelligenceDecision",
        entityId: result.id,
        action: "FOLLOW_UP_DECISION_RECORDED",
        after: { decision, reason, guardrailCode, advisoryOnly: true },
        correlationId
      }
    });
    return result;
  });

  if (decision === "ESCALATE" || decision === "ASK_HUMAN") {
    await requireHumanAction({
      leadId,
      reason: guardrailCode ?? "INTELLIGENCE_REQUIRES_HUMAN",
      actorType: "SYSTEM",
      sourceType: "LEAD_INTELLIGENCE_DECISION",
      sourceId: created.id,
      correlationId
    });
  } else if (decision === "STOP") {
    await stopAi({
      leadId,
      reason: guardrailCode ?? "INTELLIGENCE_STOP",
      actorType: "SYSTEM",
      sourceType: "LEAD_INTELLIGENCE_DECISION",
      sourceId: created.id,
      correlationId
    });
  }
  await publishRealtimeEvent({ entityType: "lead", action: "follow-up-decision-recorded", leadId });
  return {
    id: created.id,
    leadId,
    decision: created.decision,
    reason: created.reason,
    nextObjective: created.nextObjective,
    factors: created.factors,
    evidence: created.evidence as unknown as IntelligenceEvidenceDto[],
    guardrailCode: created.guardrailCode,
    correlationId: created.correlationId,
    createdAt: created.createdAt.toISOString()
  };
}

function splitDocument(content: string): string[] {
  const paragraphs = content
    .split(/\n{2,}/)
    .map((item) => clip(item, 1200))
    .filter(Boolean);
  if (paragraphs.length > 0) return paragraphs.slice(0, 250);
  return (
    content
      .match(/[\s\S]{1,1200}/g)
      ?.map((item) => item.trim())
      .filter(Boolean) ?? []
  );
}

export async function createLeadDocument(
  actor: AuthenticatedUser,
  leadId: string,
  input: CreateLeadDocumentInput
): Promise<LeadDocumentDto> {
  const lead = await loadLead(actor, leadId);
  const content = input.content?.trim() ?? "";
  const chunks = splitDocument(content);
  const now = new Date();
  const created = await prisma.$transaction(async (tx) => {
    const document = await tx.leadDocument.create({
      data: {
        workspaceId: lead.workspaceId,
        leadId,
        title: input.title,
        kind: input.kind,
        sourceType: input.sourceType,
        sourceUrl: input.sourceUrl,
        mimeType: input.mimeType,
        status: chunks.length ? "INDEXED" : "NEEDS_CONTENT",
        extractedText: content || null,
        checksum: content ? createHash("sha256").update(content).digest("hex") : null,
        createdByUserId: actor.id,
        indexedAt: chunks.length ? now : null,
        chunks: {
          create: chunks.map((chunk, position) => ({
            workspaceId: lead.workspaceId,
            leadId,
            position,
            content: chunk
          }))
        }
      },
      include: { _count: { select: { chunks: true } } }
    });
    await tx.activity.create({
      data: {
        workspaceId: lead.workspaceId,
        leadId,
        actorType: "USER",
        actorUserId: actor.id,
        sourceType: "LEAD_DOCUMENT",
        sourceId: document.id,
        type: "LEAD_DOCUMENT_INDEXED",
        title: chunks.length ? "Lead document indexed" : "Lead document linked",
        description: `${input.title} was added to grounded lead intelligence.`,
        metadata: { kind: input.kind, status: document.status, chunkCount: chunks.length },
        visibility: "BUSINESS"
      }
    });
    await tx.auditEvent.create({
      data: {
        workspaceId: lead.workspaceId,
        actorType: "USER",
        actorId: actor.id,
        actorUserId: actor.id,
        sourceType: "LEAD_DOCUMENT",
        sourceId: document.id,
        entityType: "LeadDocument",
        entityId: document.id,
        action: "LEAD_DOCUMENT_CREATED",
        after: {
          title: input.title,
          kind: input.kind,
          status: document.status,
          chunkCount: chunks.length
        }
      }
    });
    return document;
  });
  await refreshLeadIntelligence(actor, leadId);
  await publishRealtimeEvent({ entityType: "lead", action: "lead-document-updated", leadId });
  return documentDto(created);
}

export async function deleteLeadDocument(
  actor: AuthenticatedUser,
  leadId: string,
  documentId: string
): Promise<void> {
  const lead = await loadLead(actor, leadId);
  const document = await prisma.leadDocument.findFirst({
    where: { id: documentId, leadId, workspaceId: lead.workspaceId }
  });
  if (!document) throw new AppError(404, "NOT_FOUND", "Lead document not found");
  await prisma.$transaction(async (tx) => {
    await tx.leadDocument.delete({ where: { id: documentId } });
    await tx.auditEvent.create({
      data: {
        workspaceId: lead.workspaceId,
        actorType: "USER",
        actorId: actor.id,
        actorUserId: actor.id,
        sourceType: "LEAD_DOCUMENT",
        sourceId: documentId,
        entityType: "LeadDocument",
        entityId: documentId,
        action: "LEAD_DOCUMENT_DELETED",
        before: { title: document.title, kind: document.kind }
      }
    });
  });
  await publishRealtimeEvent({ entityType: "lead", action: "lead-document-updated", leadId });
}

interface CommandCenterAggregate {
  activeLeads: bigint;
  humanRequired: bigint;
  aiActive: bigint;
  hotLeads: bigint;
  humanActive: bigint;
  aiPaused: bigint;
  aiStopped: bigint;
  pipelineValue: string;
}

interface MessageAggregate {
  clientResponses: bigint;
  aiReplies: bigint;
  averageResponseMinutes: number | null;
  averageFirstResponseMinutes: number | null;
}

interface ActivityAggregate {
  leadsHandled: bigint;
  proposalsSent: bigint;
  meetingsBookedHuman: bigint;
  meetingsBookedAi: bigint;
  handovers: bigint;
}

interface FollowUpAggregate {
  followUpsSent: bigint;
  reengagements: bigint;
  leadsRevived: bigint;
  convertedLeads: bigint;
  followedLeads: bigint;
}

function aggregateNumber(value: bigint | number | null | undefined): number {
  return Number(value ?? 0);
}

export async function getAiCommandCenter(actor: AuthenticatedUser): Promise<AiCommandCenterDto> {
  if (actor.role !== UserRole.ADMIN && actor.role !== UserRole.SALES_MANAGER) {
    throw new AppError(403, "AUTHORIZATION_ERROR", "Command Center requires manager access");
  }
  const workspaceId = workspaceIdOrThrow(actor);
  const now = new Date();
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(startOfDay.getTime() + DAY_MS);

  const [
    activeRows,
    recommendationRows,
    meetingsToday,
    proposalsPending,
    overdueHumanActions,
    messageRows,
    activityRows,
    completedHumanTasks,
    followUpRows,
    dealGroups,
    preferredCurrencyDeal
  ] = await Promise.all([
    prisma.$queryRaw<CommandCenterAggregate[]>`
      SELECT
        COUNT(*)::bigint AS "activeLeads",
        COUNT(*) FILTER (WHERE l."automationOwnershipState" = 'HUMAN_REQUIRED')::bigint AS "humanRequired",
        COUNT(*) FILTER (WHERE l."automationOwnershipState" = 'AI_ACTIVE')::bigint AS "aiActive",
        COUNT(*) FILTER (WHERE l."temperature" = 'HOT')::bigint AS "hotLeads",
        COUNT(*) FILTER (
          WHERE l."automationOwnershipState" IN ('HUMAN_ACTIVE', 'HUMAN_ACTION_COMPLETED')
        )::bigint AS "humanActive",
        COUNT(*) FILTER (WHERE i."aiControlStatus" = 'PAUSED')::bigint AS "aiPaused",
        COUNT(*) FILTER (
          WHERE l."automationOwnershipState" = 'AI_STOPPED' OR i."aiControlStatus" = 'OFF'
        )::bigint AS "aiStopped",
        COALESCE(SUM(COALESCE(d."value", l."estimatedValue", 0)), 0)::text AS "pipelineValue"
      FROM "Lead" l
      LEFT JOIN "Deal" d ON d."leadId" = l."id"
      LEFT JOIN "LeadIntelligence" i ON i."leadId" = l."id"
      WHERE l."workspaceId" = ${workspaceId}
        AND l."status" NOT IN ('WON', 'LOST', 'DISQUALIFIED')
    `,
    prisma.$queryRaw<{ id: string }[]>`
      SELECT l."id"
      FROM "Lead" l
      LEFT JOIN LATERAL (
        SELECT d."decision"
        FROM "LeadIntelligenceDecision" d
        WHERE d."leadId" = l."id"
        ORDER BY d."createdAt" DESC
        LIMIT 1
      ) latest ON true
      WHERE l."workspaceId" = ${workspaceId}
        AND l."status" NOT IN ('WON', 'LOST', 'DISQUALIFIED')
      ORDER BY
        CASE latest."decision"
          WHEN 'ESCALATE' THEN 0
          WHEN 'ASK_HUMAN' THEN 1
          WHEN 'FOLLOW_UP' THEN 2
          ELSE 3
        END,
        l."score" DESC,
        l."lastActivityAt" DESC NULLS LAST,
        l."createdAt" DESC
      LIMIT 50
    `,
    prisma.meetingRequest.count({
      where: { workspaceId, status: "CONFIRMED", confirmedAt: { gte: startOfDay, lt: endOfDay } }
    }),
    prisma.proposal.count({
      where: { workspaceId, status: { in: ["WAITING_APPROVAL", "APPROVED"] } }
    }),
    prisma.task.count({
      where: {
        workspaceId,
        status: { in: ["OPEN", "IN_PROGRESS"] },
        dueAt: { lt: now },
        createdByType: "USER"
      }
    }),
    prisma.$queryRaw<MessageAggregate[]>`
      WITH message_totals AS (
        SELECT
          COUNT(*) FILTER (
            WHERE m."direction" = 'INBOUND' AND m."senderType" = 'PROSPECT'
          )::bigint AS "clientResponses",
          COUNT(*) FILTER (
            WHERE m."direction" = 'OUTBOUND' AND m."senderType" = 'AI'
          )::bigint AS "aiReplies"
        FROM "Message" m
        JOIN "Conversation" c ON c."id" = m."conversationId"
        WHERE c."workspaceId" = ${workspaceId}
      ),
      first_response AS (
        SELECT AVG(EXTRACT(EPOCH FROM (first_human."createdAt" - l."createdAt")) / 60.0)::float8
          AS "averageFirstResponseMinutes"
        FROM "Conversation" c
        JOIN "Lead" l ON l."id" = c."leadId"
        JOIN LATERAL (
          SELECT MIN(m."createdAt") AS "createdAt"
          FROM "Message" m
          WHERE m."conversationId" = c."id"
            AND m."direction" = 'OUTBOUND'
            AND m."senderType" = 'USER'
            AND m."createdAt" >= l."createdAt"
        ) first_human ON first_human."createdAt" IS NOT NULL
        WHERE c."workspaceId" = ${workspaceId}
      ),
      response_time AS (
        SELECT AVG(EXTRACT(EPOCH FROM (human_reply."createdAt" - inbound."createdAt")) / 60.0)::float8
          AS "averageResponseMinutes"
        FROM "Message" inbound
        JOIN "Conversation" c ON c."id" = inbound."conversationId"
        JOIN LATERAL (
          SELECT MIN(outbound."createdAt") AS "createdAt"
          FROM "Message" outbound
          WHERE outbound."conversationId" = inbound."conversationId"
            AND outbound."createdAt" > inbound."createdAt"
            AND outbound."direction" = 'OUTBOUND'
            AND outbound."senderType" = 'USER'
        ) human_reply ON human_reply."createdAt" IS NOT NULL
        WHERE c."workspaceId" = ${workspaceId}
          AND inbound."direction" = 'INBOUND'
          AND inbound."senderType" = 'PROSPECT'
      )
      SELECT
        message_totals."clientResponses",
        message_totals."aiReplies",
        response_time."averageResponseMinutes",
        first_response."averageFirstResponseMinutes"
      FROM message_totals, response_time, first_response
    `,
    prisma.$queryRaw<ActivityAggregate[]>`
      SELECT
        COUNT(DISTINCT "leadId") FILTER (WHERE "actorType" = 'USER')::bigint AS "leadsHandled",
        COUNT(*) FILTER (WHERE "type" = 'PROPOSAL_SENT' AND "actorType" = 'USER')::bigint
          AS "proposalsSent",
        COUNT(*) FILTER (WHERE "type" = 'MEETING_CONFIRMED' AND "actorType" = 'USER')::bigint
          AS "meetingsBookedHuman",
        COUNT(*) FILTER (WHERE "type" = 'MEETING_CONFIRMED' AND "actorType" <> 'USER')::bigint
          AS "meetingsBookedAi",
        COUNT(*) FILTER (
          WHERE "type" IN ('HUMAN_TAKEOVER', 'NEGOTIATION_HANDOFF')
        )::bigint AS "handovers"
      FROM "Activity"
      WHERE "workspaceId" = ${workspaceId} AND "visibility" = 'BUSINESS'
    `,
    prisma.task.count({ where: { workspaceId, status: "COMPLETED", completedByType: "USER" } }),
    prisma.$queryRaw<FollowUpAggregate[]>`
      SELECT
        COUNT(*)::bigint AS "followUpsSent",
        COUNT(DISTINCT f."leadId") FILTER (WHERE f."kind" = 'FOLLOW_UP')::bigint
          AS "reengagements",
        COUNT(DISTINCT f."leadId") FILTER (
          WHERE EXISTS (
            SELECT 1
            FROM "Conversation" c
            JOIN "Message" m ON m."conversationId" = c."id"
            WHERE c."leadId" = f."leadId"
              AND m."direction" = 'INBOUND'
              AND m."senderType" = 'PROSPECT'
              AND m."createdAt" > f."sentAt"
          )
        )::bigint AS "leadsRevived",
        COUNT(DISTINCT f."leadId") FILTER (
          WHERE EXISTS (
            SELECT 1 FROM "Deal" d WHERE d."leadId" = f."leadId" AND d."status" = 'WON'
          )
        )::bigint AS "convertedLeads",
        COUNT(DISTINCT f."leadId")::bigint AS "followedLeads"
      FROM "FollowUpAttempt" f
      JOIN "Lead" l ON l."id" = f."leadId"
      WHERE l."workspaceId" = ${workspaceId} AND f."status" = 'SENT'
    `,
    prisma.deal.groupBy({
      by: ["status", "currency"],
      where: { workspaceId },
      _count: { _all: true },
      _sum: { value: true }
    }),
    prisma.deal.findFirst({
      where: { workspaceId },
      orderBy: [{ status: "desc" }, { createdAt: "asc" }],
      select: { currency: true }
    })
  ]);

  const recommendationIds = recommendationRows.map(({ id }) => id);
  const recommendationLeads = recommendationIds.length
    ? await prisma.lead.findMany({
        where: { workspaceId, id: { in: recommendationIds } },
        include: {
          contact: true,
          company: true,
          owner: true,
          stage: true,
          deal: true,
          intelligence: true,
          intelligenceDecisions: { orderBy: { createdAt: "desc" }, take: 1 }
        }
      })
    : [];
  const leadById = new Map(recommendationLeads.map((lead) => [lead.id, lead]));
  const recommendations = recommendationIds.flatMap((leadId) => {
    const lead = leadById.get(leadId);
    if (!lead) return [];
    const latest = lead.intelligenceDecisions[0] ?? null;
    const aiStatus = lead.intelligence?.aiControlStatus ?? LeadAiControlStatus.ON;
    return [
      {
        leadId: lead.id,
        contactName: [lead.contact.firstName, lead.contact.lastName].filter(Boolean).join(" "),
        companyName: lead.company.name,
        ownerName: lead.owner
          ? [lead.owner.firstName, lead.owner.lastName].filter(Boolean).join(" ")
          : null,
        status: lead.status,
        stage: lead.stage.label,
        score: lead.score,
        temperature: lead.temperature,
        dealValue: lead.deal?.value?.toString() ?? lead.estimatedValue?.toString() ?? null,
        currency: lead.deal?.currency ?? lead.currency,
        automationState: lead.automationOwnershipState,
        aiControlStatus: aiStatus,
        healthScore: lead.intelligence?.healthScore ?? lead.score,
        decision: latest?.decision ?? null,
        recommendation:
          latest?.reason ??
          (lead.automationOwnershipState === "HUMAN_REQUIRED"
            ? "Human action is required before automation can continue."
            : (lead.nextAction ?? "Refresh lead intelligence.")),
        nextObjective: lead.intelligence?.nextObjective ?? lead.nextAction,
        lastActivityAt: lead.lastActivityAt?.toISOString() ?? null
      }
    ];
  });

  const active = activeRows[0];
  const messages = messageRows[0];
  const activities = activityRows[0];
  const followUps = followUpRows[0];
  const opportunities = dealGroups.reduce((sum, group) => sum + group._count._all, 0);
  const wonDeals = dealGroups
    .filter((group) => group.status === "WON")
    .reduce((sum, group) => sum + group._count._all, 0);
  const currency = preferredCurrencyDeal?.currency ?? "INR";
  const comparableWonDeals = dealGroups.find(
    (group) => group.status === "WON" && group.currency === currency
  );
  const comparableWonCount = comparableWonDeals?._count._all ?? 0;
  const revenue = Number(comparableWonDeals?._sum.value ?? 0);
  const roundAverage = (value: number | null | undefined): number | null =>
    value == null ? null : Math.round(value * 10) / 10;
  const activeLeads = aggregateNumber(active?.activeLeads);
  const humanRequired = aggregateNumber(active?.humanRequired);
  const aiActive = aggregateNumber(active?.aiActive);

  return {
    generatedAt: now.toISOString(),
    metrics: {
      activeLeads,
      humanRequired,
      aiActive,
      hotLeads: aggregateNumber(active?.hotLeads),
      overdueHumanActions,
      proposalsPending,
      meetingsToday,
      pipelineValue: Number(active?.pipelineValue ?? 0).toFixed(2)
    },
    humanSignals: {
      required: humanRequired,
      overdue: overdueHumanActions,
      active: aggregateNumber(active?.humanActive)
    },
    aiSignals: {
      active: aiActive,
      paused: aggregateNumber(active?.aiPaused),
      stopped: aggregateNumber(active?.aiStopped)
    },
    humanKpis: {
      averageResponseMinutes: roundAverage(messages?.averageResponseMinutes),
      averageFirstResponseMinutes: roundAverage(messages?.averageFirstResponseMinutes),
      leadsHandled: aggregateNumber(activities?.leadsHandled),
      clientResponses: aggregateNumber(messages?.clientResponses),
      proposalsSent: aggregateNumber(activities?.proposalsSent),
      meetingsBooked: aggregateNumber(activities?.meetingsBookedHuman),
      followUpsCompleted: completedHumanTasks,
      opportunities,
      conversionRate: opportunities ? Math.round((wonDeals / opportunities) * 1000) / 10 : 0,
      revenue: revenue.toFixed(2),
      averageDealValue: comparableWonCount ? (revenue / comparableWonCount).toFixed(2) : "0.00",
      currency
    },
    aiKpis: {
      followUpsSent: aggregateNumber(followUps?.followUpsSent),
      repliesGenerated: aggregateNumber(messages?.aiReplies),
      meetingsGenerated: aggregateNumber(activities?.meetingsBookedAi),
      reengagements: aggregateNumber(followUps?.reengagements),
      followUpConversionRate: aggregateNumber(followUps?.followedLeads)
        ? Math.round(
            (aggregateNumber(followUps?.convertedLeads) /
              aggregateNumber(followUps?.followedLeads)) *
              1000
          ) / 10
        : 0,
      leadsRevived: aggregateNumber(followUps?.leadsRevived),
      humanInterventions: humanRequired,
      handovers: aggregateNumber(activities?.handovers)
    },
    recommendations
  };
}
