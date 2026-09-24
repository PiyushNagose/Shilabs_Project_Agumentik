import { AgentCorrectionSourceType, Prisma } from "@prisma/client";
import type { AgentCorrectionDto } from "@shilabs/shared-types";
import { AppError } from "../../shared/errors.js";
import { prisma } from "../../shared/prisma.js";
import { toPublicUser } from "../auth/auth.service.js";
import type { AuthenticatedUser } from "../auth/auth.types.js";
import { publishDomainEvent } from "../domain-events/domain-events.service.js";
import type {
  CreateAgentCorrectionInput,
  CreateProposalCorrectionInput,
  ListAgentCorrectionsQuery
} from "./agent-feedback.schemas.js";

const correctionInclude = {
  correctedBy: true
} satisfies Prisma.AgentCorrectionInclude;

type AgentCorrectionRecord = Prisma.AgentCorrectionGetPayload<{ include: typeof correctionInclude }>;

interface CorrectionSourceContext {
  sourceEntityType: AgentCorrectionSourceType;
  sourceEntityId: string;
  agentModule: string;
  leadId: string | null;
  proposalId: string | null;
  conversationId: string | null;
  proposalGenerationRunId: string | null;
  replyProcessingRunId: string | null;
  previousOutput: Prisma.InputJsonValue;
}

function toJson(value: unknown): Prisma.InputJsonValue {
  if (value === undefined) {
    throw new AppError(400, "VALIDATION_ERROR", "correctedOutcome is required");
  }
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function toDto(record: AgentCorrectionRecord): AgentCorrectionDto {
  return {
    id: record.id,
    agentModule: record.agentModule,
    sourceEntityType: record.sourceEntityType,
    sourceEntityId: record.sourceEntityId,
    leadId: record.leadId,
    proposalId: record.proposalId,
    conversationId: record.conversationId,
    proposalGenerationRunId: record.proposalGenerationRunId,
    replyProcessingRunId: record.replyProcessingRunId,
    previousOutput: record.previousOutput,
    correctedOutcome: record.correctedOutcome,
    correctionSummary: record.correctionSummary,
    status: record.status,
    version: record.version,
    supersedesCorrectionId: record.supersedesCorrectionId,
    correctedByUserId: record.correctedByUserId,
    correctedBy: toPublicUser(record.correctedBy),
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString()
  };
}

async function sourceFromProposalGenerationRun(id: string): Promise<CorrectionSourceContext> {
  const run = await prisma.proposalGenerationRun.findUnique({
    where: { id },
    include: { proposal: { include: { currentVersion: true } } }
  });
  if (!run) throw new AppError(404, "NOT_FOUND", "Proposal generation run not found");
  return {
    sourceEntityType: "PROPOSAL_GENERATION_RUN",
    sourceEntityId: run.id,
    agentModule: `proposal-generation:${run.kind}`,
    leadId: run.leadId,
    proposalId: run.proposalId,
    conversationId: null,
    proposalGenerationRunId: run.id,
    replyProcessingRunId: null,
    previousOutput: {
      provider: run.provider,
      model: run.model,
      status: run.status,
      aiOutput: run.aiOutput,
      inputContext: run.inputContext,
      approvedKnowledge: run.approvedKnowledge,
      toolEvidence: run.toolEvidence,
      proposal: run.proposal
        ? {
            id: run.proposal.id,
            title: run.proposal.title,
            status: run.proposal.status,
            currentVersionId: run.proposal.currentVersionId,
            currentVersion: run.proposal.currentVersion
              ? {
                  id: run.proposal.currentVersion.id,
                  version: run.proposal.currentVersion.version,
                  title: run.proposal.currentVersion.title,
                  content: run.proposal.currentVersion.content
                }
              : null
          }
        : null
    }
  };
}

async function sourceFromReplyProcessingRun(id: string): Promise<CorrectionSourceContext> {
  const run = await prisma.replyProcessingRun.findUnique({ where: { id } });
  if (!run) throw new AppError(404, "NOT_FOUND", "Reply processing run not found");
  return {
    sourceEntityType: "REPLY_PROCESSING_RUN",
    sourceEntityId: run.id,
    agentModule: "reply-understanding",
    leadId: run.leadId,
    proposalId: null,
    conversationId: run.conversationId,
    proposalGenerationRunId: null,
    replyProcessingRunId: run.id,
    previousOutput: {
      provider: run.provider,
      model: run.model,
      status: run.status,
      intent: run.intent,
      recommendedAction: run.recommendedAction,
      confidence: run.confidence?.toString() ?? null,
      summary: run.summary,
      draftResponse: run.draftResponse,
      requiresHumanReview: run.requiresHumanReview,
      humanHandoffRequired: run.humanHandoffRequired,
      output: run.output,
      inputContext: run.inputContext
    }
  };
}

async function resolveSource(input: {
  sourceEntityType: AgentCorrectionSourceType;
  sourceEntityId: string;
}): Promise<CorrectionSourceContext> {
  if (input.sourceEntityType === "PROPOSAL_GENERATION_RUN") {
    return sourceFromProposalGenerationRun(input.sourceEntityId);
  }
  return sourceFromReplyProcessingRun(input.sourceEntityId);
}

async function resolveLatestProposalGenerationRun(proposalId: string): Promise<CorrectionSourceContext> {
  const run = await prisma.proposalGenerationRun.findFirst({
    where: { proposalId },
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }]
  });
  if (!run) {
    throw new AppError(409, "CONFLICT", "Proposal has no linked AI proposal generation run");
  }
  return sourceFromProposalGenerationRun(run.id);
}

async function nextVersionForSource(source: CorrectionSourceContext): Promise<number> {
  const latest = await prisma.agentCorrection.findFirst({
    where: { sourceEntityType: source.sourceEntityType, sourceEntityId: source.sourceEntityId },
    orderBy: { version: "desc" },
    select: { version: true }
  });
  return (latest?.version ?? 0) + 1;
}

async function createCorrectionRecord(input: {
  actor: AuthenticatedUser;
  source: CorrectionSourceContext;
  correctedOutcome: unknown;
  correctionSummary: string;
  supersedesCorrectionId?: string;
}): Promise<AgentCorrectionDto> {
  const correctedOutcome = toJson(input.correctedOutcome);
  if (!input.source.leadId) {
    throw new AppError(409, "CONFLICT", "Correction source is missing lead context");
  }
  const leadId = input.source.leadId;
  const version = await nextVersionForSource(input.source);

  const correction = await prisma.$transaction(
    async (tx) => {
      if (input.supersedesCorrectionId) {
        const superseded = await tx.agentCorrection.findUnique({
          where: { id: input.supersedesCorrectionId },
          select: { sourceEntityType: true, sourceEntityId: true }
        });
        if (!superseded) throw new AppError(404, "NOT_FOUND", "Superseded correction not found");
        if (
          superseded.sourceEntityType !== input.source.sourceEntityType ||
          superseded.sourceEntityId !== input.source.sourceEntityId
        ) {
          throw new AppError(400, "VALIDATION_ERROR", "Superseded correction must match the same source");
        }
        await tx.agentCorrection.update({
          where: { id: input.supersedesCorrectionId },
          data: { status: "SUPERSEDED" }
        });
      }

      const created = await tx.agentCorrection.create({
        data: {
          agentModule: input.source.agentModule,
          sourceEntityType: input.source.sourceEntityType,
          sourceEntityId: input.source.sourceEntityId,
          leadId: input.source.leadId,
          proposalId: input.source.proposalId,
          conversationId: input.source.conversationId,
          proposalGenerationRunId: input.source.proposalGenerationRunId,
          replyProcessingRunId: input.source.replyProcessingRunId,
          previousOutput: input.source.previousOutput,
          correctedOutcome,
          correctionSummary: input.correctionSummary,
          version,
          supersedesCorrectionId: input.supersedesCorrectionId ?? null,
          correctedByUserId: input.actor.id
        },
        include: correctionInclude
      });
      await tx.activity.create({
        data: {
          leadId,
          actorUserId: input.actor.id,
          type: "AGENT_CORRECTION_RECORDED",
          description: `Agent correction recorded for ${input.source.agentModule}`
        }
      });
      await tx.auditEvent.create({
        data: {
          actorType: "USER",
          actorId: input.actor.id,
          entityType: "AgentCorrection",
          entityId: created.id,
          action: "AGENT_CORRECTION_RECORDED",
          after: {
            agentModule: input.source.agentModule,
            sourceEntityType: input.source.sourceEntityType,
            sourceEntityId: input.source.sourceEntityId,
            version,
            policies: {
              kbPromotion: "UNRESOLVED",
              exportTraining: "UNRESOLVED",
              retention: "UNRESOLVED",
              fineTuning: "NOT_IMPLEMENTED"
            }
          }
        }
      });
      await publishDomainEvent({
        client: tx,
        eventType: "AGENT_CORRECTION_RECORDED",
        aggregateType: "AgentCorrection",
        aggregateId: created.id,
        payload: {
          leadId: input.source.leadId,
          agentModule: input.source.agentModule,
          sourceEntityType: input.source.sourceEntityType,
          sourceEntityId: input.source.sourceEntityId
        },
        correlationId: input.source.sourceEntityId,
        idempotencyKey: `agent-correction:${created.id}`,
        maxAttempts: 1
      });
      return created;
    },
    { maxWait: 10000, timeout: 30000 }
  );

  return toDto(correction);
}

export async function createAgentCorrection(
  actor: AuthenticatedUser,
  input: CreateAgentCorrectionInput
): Promise<AgentCorrectionDto> {
  const source = await resolveSource({
    sourceEntityType: input.sourceEntityType,
    sourceEntityId: input.sourceEntityId
  });
  return createCorrectionRecord({
    actor,
    source,
    correctedOutcome: input.correctedOutcome,
    correctionSummary: input.correctionSummary,
    supersedesCorrectionId: input.supersedesCorrectionId
  });
}

export async function createProposalAgentCorrection(
  actor: AuthenticatedUser,
  proposalId: string,
  input: CreateProposalCorrectionInput
): Promise<AgentCorrectionDto> {
  const source = await resolveLatestProposalGenerationRun(proposalId);
  return createCorrectionRecord({
    actor,
    source,
    correctedOutcome: input.correctedOutcome,
    correctionSummary: input.correctionSummary,
    supersedesCorrectionId: input.supersedesCorrectionId
  });
}

export async function listAgentCorrections(
  query: ListAgentCorrectionsQuery
): Promise<AgentCorrectionDto[]> {
  const corrections = await prisma.agentCorrection.findMany({
    where: {
      sourceEntityType: query.sourceEntityType,
      sourceEntityId: query.sourceEntityId,
      leadId: query.leadId,
      proposalId: query.proposalId
    },
    include: correctionInclude,
    orderBy: [{ createdAt: "desc" }],
    take: query.limit
  });
  return corrections.map(toDto);
}
