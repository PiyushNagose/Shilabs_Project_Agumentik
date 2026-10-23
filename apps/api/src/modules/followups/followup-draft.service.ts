import { AgentType, Prisma } from "@prisma/client";
import { AppError } from "../../shared/errors.js";
import { prisma } from "../../shared/prisma.js";
import { assertAgentCapabilityActive } from "../agents/agent.service.js";
import { createAIProvider } from "../ai/ai.factory.js";
import type { AIProvider } from "../ai/ai.provider.js";
import { listApprovedKnowledge } from "../knowledge-base/knowledge-base.service.js";
import { requireHumanActionInTransaction } from "../leads/lead-automation-ownership.service.js";
import { publishRealtimeEvent } from "../realtime/realtime.service.js";
import { isNonMeaningfulInboundMetadata } from "../email/inbound-email-classification.js";
import { assertSafeFollowUpDraft } from "./followup.service.js";
import { resolveFollowUpCommunicationPersonality } from "./followup-policy.service.js";
import { followUpReadyAt } from "./followup-timing.js";
import { decideFollowUpAttempt } from "../lead-intelligence/lead-intelligence.service.js";

export async function prepareFollowUpDraft(
  workspaceId: string,
  attemptId: string,
  options?: { provider?: AIProvider }
): Promise<{ subject: string; textBody: string } | { waitUntil: string }> {
  const attempt = await prisma.followUpAttempt.findFirst({
    where: { id: attemptId, sequence: { workspaceId } },
    include: {
      sequence: true,
      lead: {
        include: {
          company: true,
          contact: true,
          qualification: true,
          intelligence: true,
          stage: true,
          proposals: { orderBy: { updatedAt: "desc" }, take: 3 },
          meetingRequests: { orderBy: { updatedAt: "desc" }, take: 3 },
        }
      }
    }
  });
  if (attempt?.lead.workspaceId !== workspaceId) {
    throw new AppError(404, "NOT_FOUND", "Follow-up attempt not found");
  }
  const lead = attempt.lead;
  if (
    attempt.status !== "SCHEDULED" ||
    attempt.sequence.status !== "ACTIVE" ||
    lead.automationOwnershipState !== "AI_ACTIVE" ||
    lead.contact.doNotContact ||
    ["WON", "LOST", "DISQUALIFIED"].includes(lead.status) ||
    ["OFF", "PAUSED"].includes(lead.intelligence?.aiControlStatus ?? "") ||
    lead.intelligence?.humanInterventionRequired
  ) {
    throw new AppError(409, "CONFLICT", "This lead is not available for automatic follow-up.");
  }
  await assertAgentCapabilityActive(workspaceId, AgentType.OUTREACH);
  const decision = await decideFollowUpAttempt(workspaceId, lead.id, attempt.id);
  if (decision.decision !== "FOLLOW_UP") {
    const factors = decision.factors as Prisma.JsonObject;
    const scheduledAt = factors.scheduledFollowUpAt;
    if (decision.decision === "WAIT" && !decision.guardrailCode && typeof scheduledAt === "string") {
      return { waitUntil: scheduledAt };
    }
    throw new AppError(409, "CONFLICT", decision.reason);
  }
  const readyAt = followUpReadyAt({
    sequenceCreatedAt: attempt.sequence.createdAt,
    scheduledAt: attempt.scheduledAt,
    stepIndex: attempt.stepIndex,
    cadenceDays: attempt.sequence.cadenceDays,
    cadenceMode: attempt.sequence.cadenceMode,
    nextActionAt: lead.nextActionAt
  });
  if (readyAt.getTime() > Date.now()) return { waitUntil: readyAt.toISOString() };
  const communicationPersonality = await resolveFollowUpCommunicationPersonality(workspaceId, {
    companyId: lead.companyId,
    service: lead.serviceInterest,
    leadType: lead.leadType,
    source: lead.source,
    country: lead.country ?? lead.company.location,
    priority: lead.priority ?? lead.temperature,
    managerId: lead.ownerId,
    campaign: lead.campaign,
    pipelineStageId: lead.stageId
  });
  const [messages, activities, approvedKnowledge] = await Promise.all([
    prisma.message.findMany({
      where: {
        OR: [{ workspaceId }, { workspaceId: null }],
        conversation: { leadId: lead.id, lead: { workspaceId } }
      },
      select: { id: true, senderType: true, body: true, metadata: true },
      orderBy: { createdAt: "desc" },
      take: 30
    }),
    prisma.activity.findMany({
      where: { workspaceId, leadId: lead.id, visibility: "BUSINESS" },
      select: { title: true, description: true, occurredAt: true },
      orderBy: { occurredAt: "desc" },
      take: 5
    }),
    listApprovedKnowledge(workspaceId, { limit: 10 })
  ]);
  const searchTerms = [
    lead.requirement,
    lead.serviceInterest,
    lead.intelligence?.nextObjective,
    ...messages.filter((item) => item.senderType === "PROSPECT").slice(0, 3).map((item) => item.body)
  ]
    .filter((value): value is string => Boolean(value))
    .join(" ")
    .toLowerCase()
    .match(/[a-z0-9]{3,}/gu);
  const searchQuery = [...new Set(searchTerms ?? [])].slice(0, 24).join(" | ");
  const documentEvidence = await prisma.$queryRaw<
    { documentId: string; title: string; kind: string; content: string }[]
  >(Prisma.sql`
    SELECT d.id AS "documentId", d.title, d.kind::text AS kind, c.content
    FROM "LeadDocumentChunk" c
    JOIN "LeadDocument" d ON d.id = c."documentId"
    WHERE d."workspaceId" = ${workspaceId}
      AND d."leadId" = ${lead.id}
      AND d.status = 'INDEXED'
      AND c."workspaceId" = ${workspaceId}
      AND c."leadId" = ${lead.id}
    ORDER BY ts_rank_cd(
      to_tsvector('english', c.content),
      to_tsquery('english', ${searchQuery})
    ) DESC, d."indexedAt" DESC, c.position ASC
    LIMIT 8
  `);
  const documentGroups = new Map<string, { id: string; title: string; kind: string; evidence: string[] }>();
  for (const row of documentEvidence) {
    const group = documentGroups.get(row.documentId) ?? {
      id: row.documentId,
      title: row.title,
      kind: row.kind,
      evidence: []
    };
    group.evidence.push(row.content.slice(0, 600));
    documentGroups.set(row.documentId, group);
  }
  const output = await (options?.provider ?? createAIProvider()).generateFollowUp({
    messages: messages
      .filter((message) => !isNonMeaningfulInboundMetadata(message.metadata))
      .reverse()
      .map((message) => ({
        id: message.id,
        senderType: message.senderType,
        body: message.body.slice(0, 1500)
      })),
    approvedKnowledge: approvedKnowledge.map((item) => ({
      id: item.versionId,
      content: item.content.slice(0, 2000)
    })),
    leadContext: JSON.stringify({
      leadId: lead.id,
      followUpDecision: {
        id: decision.id,
        reason: decision.reason,
        nextObjective: decision.nextObjective,
        factors: decision.factors,
        evidence: decision.evidence
      },
      company: lead.company.name,
      communicationPersonality,
      contact: `${lead.contact.firstName} ${lead.contact.lastName}`.trim(),
      requirement: lead.requirement?.slice(0, 1500),
      serviceInterest: lead.serviceInterest,
      stepIndex: attempt.stepIndex,
      cadenceDay: attempt.sequence.cadenceDays[attempt.stepIndex],
      stage: lead.stage.label,
      qualification: lead.qualification
        ? {
            need: lead.qualification.need?.slice(0, 500),
            budget: lead.qualification.budget?.slice(0, 500),
            authority: lead.qualification.authority?.slice(0, 500),
            timeline: lead.qualification.timeline?.slice(0, 500)
          }
        : null,
      intelligence: lead.intelligence
        ? {
            communicationStyle: lead.intelligence.communicationStyle?.slice(0, 200),
            nextObjective: lead.intelligence.nextObjective?.slice(0, 500),
            objections: lead.intelligence.objections.slice(0, 8).map((item) => item.slice(0, 200)),
            commitments: lead.intelligence.commitments.slice(0, 8).map((item) => item.slice(0, 200))
          }
        : null,
      recentActivity: activities.map((item) => ({
        ...item,
        description: item.description.slice(0, 500)
      })),
      proposals: lead.proposals.map((item) => ({ title: item.title, status: item.status })),
      meetings: lead.meetingRequests.map((item) => ({ title: item.title, status: item.status })),
      approvedLeadDocuments: [...documentGroups.values()]
    })
  });
  const current = await prisma.followUpAttempt.findFirst({
    where: {
      id: attempt.id,
      status: "SCHEDULED",
      sequence: { workspaceId, status: "ACTIVE" },
      lead: {
        workspaceId,
        automationOwnershipState: "AI_ACTIVE",
        status: { notIn: ["WON", "LOST", "DISQUALIFIED"] },
        contact: { doNotContact: false }
      }
    },
    include: { sequence: true, lead: { include: { intelligence: true } } }
  });
  if (!current || ["OFF", "PAUSED"].includes(current.lead.intelligence?.aiControlStatus ?? "") || current.lead.intelligence?.humanInterventionRequired) {
    throw new AppError(409, "CONFLICT", "This lead is not available for automatic follow-up.");
  }
  const currentReadyAt = followUpReadyAt({
    sequenceCreatedAt: current.sequence.createdAt,
    scheduledAt: current.scheduledAt,
    stepIndex: current.stepIndex,
    cadenceDays: current.sequence.cadenceDays,
    cadenceMode: current.sequence.cadenceMode,
    nextActionAt: current.lead.nextActionAt
  });
  if (currentReadyAt.getTime() > Date.now()) return { waitUntil: currentReadyAt.toISOString() };
  let needsReview =
    output.requiresHumanReview ||
    messages.some(
      (message) =>
        message.senderType === "AI" &&
        message.body.trim().toLocaleLowerCase() === output.body.trim().toLocaleLowerCase()
    );
  let reviewReason = output.requiresHumanReview
    ? output.reason?.trim() ?? "This follow-up needs a salesperson's approval."
    : "This draft repeats an earlier follow-up. Please revise it before sending.";
  try {
    assertSafeFollowUpDraft(
      output.body,
      `${lead.contact.firstName} ${lead.contact.lastName}`.trim()
    );
  } catch {
    needsReview = true;
    reviewReason = "Check the sender and wording before sending this draft.";
  }
  if (needsReview) {
    const eligible = await prisma.lead.count({
      where: {
        id: lead.id,
        workspaceId,
        automationOwnershipState: "AI_ACTIVE",
        status: { notIn: ["WON", "LOST", "DISQUALIFIED"] },
        contact: { doNotContact: false }
      }
    });
    if (!eligible)
      throw new AppError(409, "CONFLICT", "This lead is not available for automatic follow-up.");
    await prisma.$transaction(
      async (client) => {
        await requireHumanActionInTransaction({
          client,
          leadId: lead.id,
          reason: "FOLLOW_UP_REQUIRES_REVIEW",
          actorType: "SYSTEM",
          sourceType: "FOLLOW_UP",
          sourceId: attempt.id,
          correlationId: attempt.sequenceId
        });
        await client.lead.update({
          where: { id: lead.id },
          data: {
            nextAction: "Review the suggested follow-up before replying",
            nextActionAt: null
          }
        });
        await client.followUpAttempt.update({
          where: { id: attempt.id },
          data: {
            status: "BLOCKED",
            textBody: output.body,
            failureCode: "FOLLOW_UP_REQUIRES_REVIEW",
            failureMessage: reviewReason
          }
        });
        await client.followUpSequence.update({
          where: { id: attempt.sequenceId },
          data: {
            status: "ATTENTION_REQUIRED",
            lastErrorCode: "AI_FOLLOW_UP_REQUIRES_REVIEW",
            lastErrorMessage: reviewReason
          }
        });
      },
      { maxWait: 10_000, timeout: 30_000 }
    );
    await publishRealtimeEvent({
      entityType: "lead",
      action: "follow-up-review-required",
      leadId: lead.id,
      workspaceId
    });
    throw new AppError(422, "PROVIDER_ERROR", "A salesperson must review this follow-up.");
  }
  return { subject: attempt.subject, textBody: output.body };
}
