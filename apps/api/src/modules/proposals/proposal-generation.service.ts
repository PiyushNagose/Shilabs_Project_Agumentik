import { AgentType, Prisma } from "@prisma/client";
import type { ProposalGenerationResultDto, ProposalGenerationRunDto } from "@shilabs/shared-types";
import { getAIConfig } from "../../config/ai.js";
import { getSemrushConfig } from "../../config/semrush.js";
import { AppError } from "../../shared/errors.js";
import { prisma } from "../../shared/prisma.js";
import { createAIProvider } from "../ai/ai.factory.js";
import { assertAgentCapabilityActive } from "../agents/agent.service.js";
import type { AIProvider, ProposalDraftResult } from "../ai/ai.provider.js";
import type { AuthenticatedUser } from "../auth/auth.types.js";
import { publishDomainEvent } from "../domain-events/domain-events.service.js";
import { upsertIntegrationAccount } from "../integrations/integration-mapping.repository.js";
import type { SEODataProvider, SEODataResult } from "../integrations/semrush/seo-data.provider.js";
import { SemrushProvider } from "../integrations/semrush/semrush.provider.js";
import { listApprovedKnowledge } from "../knowledge-base/knowledge-base.service.js";
import { createProposal, submitProposalForApproval, toProposalDto } from "./proposal.service.js";
import { proposalInclude } from "./proposal.repository.js";
import type { GenerateProposalInput } from "./proposal-generation.schemas.js";

type GenerationRunRecord = Prisma.ProposalGenerationRunGetPayload<{
  include: { proposal: { include: typeof proposalInclude } };
}>;

interface GenerationOptions {
  aiProvider?: AIProvider;
  seoProvider?: SEODataProvider;
  env?: NodeJS.ProcessEnv;
}

interface KnowledgeEvidence {
  id: string;
  key: string;
  title: string;
  category: string;
  content: string;
  sourceTitle: string;
  sourceUrl: string | null;
}

const WEB_DESIGN_REQUIRED_FIELDS = [
  "brandName",
  "designGoals",
  "preferredStyle",
  "requiredPages"
] as const;

function toGenerationRunDto(run: GenerationRunRecord): ProposalGenerationRunDto {
  return {
    id: run.id,
    leadId: run.leadId,
    dealId: run.dealId,
    proposalId: run.proposalId,
    actorUserId: run.actorUserId,
    kind: run.kind,
    status: run.status,
    provider: run.provider,
    model: run.model,
    missingFields: run.missingFields,
    failureCode: run.failureCode,
    failureMessage: run.failureMessage,
    idempotencyKey: run.idempotencyKey,
    createdAt: run.createdAt.toISOString(),
    updatedAt: run.updatedAt.toISOString(),
    proposal: run.proposal ? toProposalDto(run.proposal) : null
  };
}

function result(run: GenerationRunRecord): ProposalGenerationResultDto {
  const dto = toGenerationRunDto(run);
  return { run: dto, proposal: dto.proposal };
}

function generationRunInclude() {
  return { proposal: { include: proposalInclude } } satisfies Prisma.ProposalGenerationRunInclude;
}

function getIdempotencyKey(input: GenerateProposalInput): string {
  return (
    input.idempotencyKey ??
    `proposal-generation:${input.kind}:${input.leadId}:${input.dealId ?? "no-deal"}`
  );
}

function getMissingWebDesignFields(input: GenerateProposalInput): string[] {
  return WEB_DESIGN_REQUIRED_FIELDS.filter((field) => {
    const value = input[field];
    return Array.isArray(value) ? value.length === 0 : !value;
  });
}

function aiMetadata(env: NodeJS.ProcessEnv = process.env): { provider: string; model: string } {
  const config = getAIConfig(env);
  return config.AI_PROVIDER === "gemini"
    ? { provider: "gemini", model: config.GEMINI_MODEL }
    : { provider: "openai", model: config.OPENAI_MODEL };
}

function sanitizeError(error: unknown): { code: string; message: string } {
  if (error instanceof AppError) return { code: error.code, message: error.message };
  if (error instanceof Error) return { code: "INTERNAL_ERROR", message: error.message };
  return { code: "INTERNAL_ERROR", message: "Proposal generation failed" };
}

function toJsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

async function ensureLeadAndDeal(input: GenerateProposalInput): Promise<void> {
  const lead = await prisma.lead.findUnique({ where: { id: input.leadId }, select: { id: true } });
  if (!lead) throw new AppError(404, "NOT_FOUND", "Lead not found");
  if (!input.dealId) return;
  const deal = await prisma.deal.findUnique({
    where: { id: input.dealId },
    select: { leadId: true }
  });
  if (!deal) throw new AppError(404, "NOT_FOUND", "Deal not found");
  if (deal.leadId !== input.leadId) {
    throw new AppError(400, "VALIDATION_ERROR", "Deal must belong to the proposal lead");
  }
}

async function loadLeadContext(leadId: string) {
  return prisma.lead.findUniqueOrThrow({
    where: { id: leadId },
    include: {
      company: true,
      contact: true,
      qualification: { include: { evidence: true } },
      conversations: {
        include: { messages: { orderBy: { createdAt: "asc" }, take: 50 } },
        orderBy: { updatedAt: "desc" },
        take: 3
      }
    }
  });
}

async function approvedKnowledge(): Promise<KnowledgeEvidence[]> {
  const entries = await listApprovedKnowledge({ limit: 30 });
  return entries.map((entry) => ({
    id: entry.versionId,
    key: entry.key,
    title: entry.title,
    category: entry.category,
    content: entry.content,
    sourceTitle: entry.sourceTitle,
    sourceUrl: entry.sourceUrl
  }));
}

async function analyzeSeo(input: {
  request: GenerateProposalInput;
  provider?: SEODataProvider;
  env?: NodeJS.ProcessEnv;
}): Promise<SEODataResult | null> {
  if (input.request.kind !== "SEO") return null;
  if (!input.request.targetWebsite) {
    throw new AppError(400, "VALIDATION_ERROR", "targetWebsite is required for SEO proposals");
  }
  const config = getSemrushConfig(input.env);
  await upsertIntegrationAccount({
    provider: "SEMRUSH",
    key: "default",
    displayName: "SEMrush",
    status: config.status,
    secretRef: "env:SEMRUSH_API_KEY",
    publicConfig: {
      endpoint: config.endpoint,
      database: config.database
    },
    lastCheckedAt: new Date(),
    lastError: config.status === "NOT_CONFIGURED" ? `Missing: ${config.missing.join(", ")}` : null
  });
  const provider = input.provider ?? new SemrushProvider(config);
  return provider.analyzeDomain({ targetUrl: input.request.targetWebsite });
}

function validateProposalOutput(input: {
  output: ProposalDraftResult;
  knowledge: KnowledgeEvidence[];
  seo: SEODataResult | null;
}): void {
  const allowedSourceIds = new Set(input.knowledge.map((item) => item.id));
  if (input.seo) allowedSourceIds.add(`semrush:${input.seo.targetUrl}`);
  const unknownKnowledge = input.output.usedKnowledgeIds.filter((id) => !allowedSourceIds.has(id));
  if (unknownKnowledge.length > 0) {
    throw new AppError(502, "PROVIDER_ERROR", "AI proposal referenced unapproved knowledge");
  }
  const unknownEvidence = input.output.evidence.filter(
    (item) => !allowedSourceIds.has(item.sourceId)
  );
  if (unknownEvidence.length > 0) {
    throw new AppError(502, "PROVIDER_ERROR", "AI proposal evidence referenced unknown sources");
  }
}

async function createRun(input: {
  actor: AuthenticatedUser;
  request: GenerateProposalInput;
  idempotencyKey: string;
  status: "COMPLETED" | "NEEDS_INPUT" | "FAILED";
  provider?: string | null;
  model?: string | null;
  proposalId?: string | null;
  inputContext: Prisma.InputJsonValue;
  approvedKnowledge?: Prisma.InputJsonValue;
  toolEvidence?: Prisma.InputJsonValue;
  aiOutput?: Prisma.InputJsonValue;
  missingFields?: string[];
  failureCode?: string | null;
  failureMessage?: string | null;
}): Promise<GenerationRunRecord> {
  return prisma.proposalGenerationRun.create({
    data: {
      leadId: input.request.leadId,
      dealId: input.request.dealId ?? null,
      proposalId: input.proposalId ?? null,
      actorUserId: input.actor.id,
      kind: input.request.kind,
      status: input.status,
      provider: input.provider ?? null,
      model: input.model ?? null,
      inputContext: input.inputContext,
      approvedKnowledge: input.approvedKnowledge,
      toolEvidence: input.toolEvidence,
      aiOutput: input.aiOutput,
      missingFields: input.missingFields ?? [],
      failureCode: input.failureCode ?? null,
      failureMessage: input.failureMessage ?? null,
      idempotencyKey: input.idempotencyKey
    },
    include: generationRunInclude()
  });
}

export async function generateProposal(
  actor: AuthenticatedUser,
  input: GenerateProposalInput,
  options?: GenerationOptions
): Promise<ProposalGenerationResultDto> {
  const idempotencyKey = getIdempotencyKey(input);
  const existing = await prisma.proposalGenerationRun.findUnique({
    where: { idempotencyKey },
    include: generationRunInclude()
  });
  if (existing) return result(existing);

  await ensureLeadAndDeal(input);

  const missingFields = input.kind === "WEB_DESIGN" ? getMissingWebDesignFields(input) : [];
  const lead = await loadLeadContext(input.leadId);
  if (lead.workspaceId) await assertAgentCapabilityActive(lead.workspaceId, AgentType.PROPOSAL);
  const inputContext = {
    kind: input.kind,
    lead: {
      id: lead.id,
      company: lead.company.name,
      website: lead.company.website,
      contact: `${lead.contact.firstName} ${lead.contact.lastName}`.trim(),
      requirement: lead.requirement,
      serviceInterest: lead.serviceInterest,
      qualification: lead.qualification
        ? {
            need: lead.qualification.need,
            requirement: lead.qualification.requirement,
            budget: lead.qualification.budget,
            budgetBand: lead.qualification.budgetBand,
            authority: lead.qualification.authority,
            timeline: lead.qualification.timeline,
            businessFit: lead.qualification.businessFit,
            decisionMakerIdentified: lead.qualification.decisionMakerIdentified,
            urgency: lead.qualification.urgency,
            evidence: lead.qualification.evidence.map((item) => ({
              id: item.id,
              messageId: item.messageId,
              quote: item.quote
            }))
          }
        : null
    },
    request: {
      targetWebsite: input.targetWebsite ?? null,
      brandName: input.brandName ?? null,
      brandGuidelines: input.brandGuidelines ?? null,
      designGoals: input.designGoals ?? null,
      preferredStyle: input.preferredStyle ?? null,
      requiredPages: input.requiredPages ?? [],
      additionalContext: input.additionalContext ?? null
    }
  };

  if (missingFields.length > 0) {
    return result(
      await createRun({
        actor,
        request: input,
        idempotencyKey,
        status: "NEEDS_INPUT",
        inputContext,
        missingFields,
        failureCode: "WEB_DESIGN_REQUIREMENTS_MISSING",
        failureMessage: `Missing web/design requirements: ${missingFields.join(", ")}`
      })
    );
  }

  const knowledge = await approvedKnowledge();
  let metadata: { provider: string; model: string } | null = null;
  try {
    metadata = aiMetadata(options?.env);
    const seo = await analyzeSeo({
      request: input,
      provider: options?.seoProvider,
      env: options?.env
    });
    const aiProvider = options?.aiProvider ?? createAIProvider(options?.env);
    const aiOutput = await aiProvider.generateProposalDraft({
      messages: lead.conversations.flatMap((conversation) =>
        conversation.messages.map((message) => ({
          id: message.id,
          senderType: message.senderType,
          body: message.body
        }))
      ),
      approvedKnowledge: [
        ...knowledge.map((item) => ({ id: item.id, content: item.content })),
        ...(seo
          ? [
              {
                id: `semrush:${seo.targetUrl}`,
                content: JSON.stringify({
                  targetUrl: seo.targetUrl,
                  database: seo.database,
                  organicKeywords: seo.organicKeywords,
                  organicTraffic: seo.organicTraffic,
                  backlinks: seo.backlinks
                })
              }
            ]
          : [])
      ],
      leadContext: JSON.stringify(inputContext)
    });
    validateProposalOutput({ output: aiOutput, knowledge, seo });
    const proposal = await createProposal(actor, {
      leadId: input.leadId,
      dealId: input.dealId,
      title: aiOutput.title,
      serviceType: aiOutput.serviceType ?? input.kind,
      content: aiOutput.content,
      editSummary: `AI-generated ${input.kind.toLowerCase()} proposal draft`,
      idempotencyKey: `proposal-from-generation:${idempotencyKey}`
    });
    const waiting = await submitProposalForApproval(actor, proposal.id, {
      reason: "AI-generated proposal requires human approval"
    });
    const run = await createRun({
      actor,
      request: input,
      idempotencyKey,
      status: "COMPLETED",
      provider: metadata.provider,
      model: metadata.model,
      proposalId: waiting.id,
      inputContext,
      approvedKnowledge: toJsonValue(
        knowledge.map((item) => ({
          id: item.id,
          key: item.key,
          title: item.title,
          category: item.category,
          sourceTitle: item.sourceTitle,
          sourceUrl: item.sourceUrl
        }))
      ),
      toolEvidence: seo ? toJsonValue({ seo }) : undefined,
      aiOutput: toJsonValue(aiOutput)
    });
    await prisma.activity.create({
      data: {
        leadId: input.leadId,
        actorUserId: actor.id,
        type: "PROPOSAL_GENERATED",
        description: `AI proposal generated: ${waiting.title}`
      }
    });
    await prisma.auditEvent.create({
      data: {
        actorType: "USER",
        actorId: actor.id,
        entityType: "ProposalGenerationRun",
        entityId: run.id,
        action: "PROPOSAL_GENERATED",
        after: { proposalId: waiting.id, kind: input.kind, status: run.status }
      }
    });
    await publishDomainEvent({
      eventType: "PROPOSAL_GENERATED",
      aggregateType: "Proposal",
      aggregateId: waiting.id,
      correlationId: run.id,
      idempotencyKey: `domain-event:proposal-generated:${run.id}`,
      payload: {
        proposalId: waiting.id,
        generationRunId: run.id,
        leadId: input.leadId,
        kind: input.kind
      }
    });
    return result(
      await prisma.proposalGenerationRun.findUniqueOrThrow({
        where: { id: run.id },
        include: generationRunInclude()
      })
    );
  } catch (error) {
    const sanitized = sanitizeError(error);
    return result(
      await createRun({
        actor,
        request: input,
        idempotencyKey,
        status: "FAILED",
        provider: metadata?.provider ?? null,
        model: metadata?.model ?? null,
        inputContext,
        approvedKnowledge: toJsonValue(
          knowledge.map((item) => ({
            id: item.id,
            key: item.key,
            title: item.title,
            category: item.category,
            sourceTitle: item.sourceTitle,
            sourceUrl: item.sourceUrl
          }))
        ),
        failureCode: sanitized.code,
        failureMessage: sanitized.message
      })
    );
  }
}
