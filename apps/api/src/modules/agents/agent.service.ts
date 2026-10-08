import { randomUUID } from "node:crypto";
import {
  AgentExecutionStatus,
  AgentStatus,
  AgentType,
  Prisma,
  UserRole,
  type Agent,
  type AgentExecution,
  type AgentVersion
} from "@prisma/client";
import type {
  AgentDashboardDto,
  AgentDetailDto,
  AgentDto,
  AgentExecutionDto,
  AgentJsonValue,
  AgentVersionDto
} from "@shilabs/shared-types";
import { AppError } from "../../shared/errors.js";
import { prisma } from "../../shared/prisma.js";
import type { AuthenticatedUser } from "../auth/auth.types.js";
import { publishRealtimeEvent } from "../realtime/realtime.service.js";
import type {
  CreateAgentInput,
  ListAgentExecutionsQuery,
  UpdateAgentInput,
  UpdateAgentStatusInput
} from "./agent.schemas.js";

interface CapabilityDefinition {
  key: string;
  type: AgentType;
  name: string;
  description: string;
  service: string;
  tools: string[];
}

const capabilities: readonly CapabilityDefinition[] = [
  {
    key: "outreach",
    type: AgentType.OUTREACH,
    name: "Outreach Agent",
    description: "Coordinates persisted follow-up and outbound outreach attempts.",
    service: "followups",
    tools: ["email", "follow-up"]
  },
  {
    key: "reply-understanding",
    type: AgentType.REPLY_UNDERSTANDING,
    name: "Reply Understanding Agent",
    description: "Interprets prospect replies and recommends the next safe action.",
    service: "reply-processing",
    tools: ["conversation", "intent"]
  },
  {
    key: "qualification",
    type: AgentType.QUALIFICATION,
    name: "Qualification Agent",
    description: "Evaluates qualification evidence and lead scoring outcomes.",
    service: "qualification",
    tools: ["qualification", "scoring"]
  },
  {
    key: "proposal",
    type: AgentType.PROPOSAL,
    name: "Proposal Agent",
    description: "Generates governed sales proposals using approved knowledge.",
    service: "proposals",
    tools: ["proposal", "knowledge"]
  },
  {
    key: "meeting",
    type: AgentType.MEETING,
    name: "Meeting Agent",
    description: "Coordinates meeting requests, slots, confirmation, and provider sync.",
    service: "meetings",
    tools: ["calendar", "meeting"]
  },
  {
    key: "voice",
    type: AgentType.VOICE,
    name: "Voice Agent",
    description: "Runs voice conversations and records business outcomes.",
    service: "voice",
    tools: ["telephony", "conversation"]
  },
  {
    key: "whatsapp",
    type: AgentType.WHATSAPP,
    name: "WhatsApp Agent",
    description: "Delivers governed WhatsApp communication through configured providers.",
    service: "messaging",
    tools: ["whatsapp", "conversation"]
  },
  {
    key: "sales-copilot",
    type: AgentType.SALES_COPILOT,
    name: "Sales Copilot",
    description: "Builds lead and meeting briefings from persisted CRM evidence.",
    service: "briefings",
    tools: ["briefing", "knowledge"]
  }
];

type AgentRecord = Agent & {
  currentVersion: AgentVersion | null;
  versions: AgentVersion[];
};

function workspaceIdFor(actor: AuthenticatedUser): string {
  if (!actor.activeWorkspaceId)
    throw new AppError(403, "AUTHORIZATION_ERROR", "Active workspace required");
  return actor.activeWorkspaceId;
}

function assertCanManage(actor: AuthenticatedUser): void {
  if (actor.role !== UserRole.ADMIN && actor.role !== UserRole.SALES_MANAGER) {
    throw new AppError(403, "AUTHORIZATION_ERROR", "Agent management requires manager access");
  }
}

const agentInclude = {
  currentVersion: true,
  versions: { orderBy: { version: "desc" as const } }
};

function jsonDto(value: Prisma.JsonValue): AgentJsonValue {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(jsonDto);
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, item === undefined ? null : jsonDto(item)])
  );
}

function versionDto(version: AgentVersion): AgentVersionDto {
  return {
    id: version.id,
    agentId: version.agentId,
    version: version.version,
    definition: jsonDto(version.definition),
    modelConfig: jsonDto(version.modelConfig),
    toolsConfig: jsonDto(version.toolsConfig),
    knowledgeConfig: jsonDto(version.knowledgeConfig),
    publishedAt: version.publishedAt?.toISOString() ?? null,
    publishedByUserId: version.publishedByUserId,
    createdAt: version.createdAt.toISOString()
  };
}

function executionDto(execution: AgentExecution): AgentExecutionDto {
  return {
    id: execution.id,
    agentId: execution.agentId,
    versionId: execution.versionId,
    source: execution.source,
    sourceEntityType: execution.sourceEntityType,
    sourceEntityId: execution.sourceEntityId,
    entityType: execution.entityType,
    entityId: execution.entityId,
    leadId: execution.leadId,
    status: execution.status,
    startedAt: execution.startedAt.toISOString(),
    completedAt: execution.completedAt?.toISOString() ?? null,
    durationMs: execution.durationMs,
    summary: execution.summary,
    result: jsonDto(execution.result),
    evaluation: jsonDto(execution.evaluation),
    correlationId: execution.correlationId
  };
}

function agentDto(agent: AgentRecord, executions: AgentExecution[]): AgentDto {
  const scoped = executions.filter((execution) => execution.agentId === agent.id);
  const successful = scoped.filter(
    (execution) => execution.status === AgentExecutionStatus.SUCCEEDED
  ).length;
  const failed = scoped.filter(
    (execution) => execution.status === AgentExecutionStatus.FAILED
  ).length;
  const completed = successful + failed;
  return {
    id: agent.id,
    key: agent.key,
    name: agent.name,
    description: agent.description,
    type: agent.type,
    status: agent.status,
    currentVersionId: agent.currentVersionId,
    createdByUserId: agent.createdByUserId,
    createdAt: agent.createdAt.toISOString(),
    updatedAt: agent.updatedAt.toISOString(),
    currentVersion: agent.currentVersion ? versionDto(agent.currentVersion) : null,
    versions: agent.versions.map(versionDto),
    executionCount: scoped.length,
    successfulExecutionCount: successful,
    failedExecutionCount: failed,
    successRate: completed > 0 ? Math.round((successful / completed) * 1000) / 10 : null,
    lastExecutedAt: scoped[0]?.startedAt.toISOString() ?? null
  };
}

async function ensureCapabilityAgents(workspaceId: string): Promise<void> {
  const existing = new Set(
    (await prisma.agent.findMany({ where: { workspaceId }, select: { key: true } })).map(
      (agent) => agent.key
    )
  );
  for (const capability of capabilities) {
    if (existing.has(capability.key)) continue;
    await prisma.$transaction(async (tx) => {
      const agent = await tx.agent.create({
        data: {
          workspaceId,
          key: capability.key,
          name: capability.name,
          description: capability.description,
          type: capability.type,
          status: AgentStatus.ACTIVE
        }
      });
      const version = await tx.agentVersion.create({
        data: {
          agentId: agent.id,
          version: 1,
          definition: { capability: capability.key, adapter: capability.service, managed: true },
          toolsConfig: { tools: capability.tools },
          publishedAt: new Date()
        }
      });
      await tx.agent.update({ where: { id: agent.id }, data: { currentVersionId: version.id } });
    });
  }
}

interface NativeExecution {
  agentType: AgentType;
  source: string;
  sourceEntityType: string;
  sourceEntityId: string;
  leadId: string | null;
  status: AgentExecutionStatus;
  startedAt: Date;
  completedAt: Date | null;
  summary: string;
  result?: Prisma.InputJsonObject;
}

function completedStatus(
  status: string,
  success: readonly string[],
  failed: readonly string[]
): AgentExecutionStatus {
  if (success.includes(status)) return AgentExecutionStatus.SUCCEEDED;
  if (failed.includes(status)) return AgentExecutionStatus.FAILED;
  return AgentExecutionStatus.RUNNING;
}

async function nativeExecutions(workspaceId: string): Promise<NativeExecution[]> {
  const [outreach, replies, scores, proposals, meetings, voices, whatsapps, briefings] =
    await Promise.all([
      prisma.followUpAttempt.findMany({
        where: { lead: { workspaceId } },
        orderBy: { createdAt: "desc" },
        take: 250
      }),
      prisma.replyProcessingRun.findMany({
        where: { lead: { workspaceId } },
        orderBy: { createdAt: "desc" },
        take: 250
      }),
      prisma.leadScoreRun.findMany({
        where: { lead: { workspaceId } },
        orderBy: { createdAt: "desc" },
        take: 250
      }),
      prisma.proposalGenerationRun.findMany({
        where: { lead: { workspaceId } },
        orderBy: { createdAt: "desc" },
        take: 250
      }),
      prisma.meetingRequest.findMany({
        where: { workspaceId },
        orderBy: { createdAt: "desc" },
        take: 250
      }),
      prisma.voiceConversationRun.findMany({
        where: { lead: { workspaceId } },
        orderBy: { createdAt: "desc" },
        take: 250
      }),
      prisma.outboundWhatsAppMessage.findMany({
        where: { workspaceId },
        orderBy: { createdAt: "desc" },
        take: 250
      }),
      prisma.briefingRun.findMany({
        where: { lead: { workspaceId } },
        orderBy: { createdAt: "desc" },
        take: 250
      })
    ]);

  return [
    ...outreach.map((run): NativeExecution => ({
      agentType: AgentType.OUTREACH,
      source: "FOLLOW_UP_ENGINE",
      sourceEntityType: "FollowUpAttempt",
      sourceEntityId: run.id,
      leadId: run.leadId,
      status: completedStatus(run.status, ["SENT"], ["FAILED", "BLOCKED", "CANCELLED", "SKIPPED"]),
      startedAt: run.createdAt,
      completedAt: run.sentAt ?? run.failedAt,
      summary:
        run.status === "SENT"
          ? `Outreach sent: ${run.subject}`
          : `Outreach ${run.status.toLowerCase()}: ${run.subject}`,
      result: { kind: run.kind, status: run.status }
    })),
    ...replies.map((run): NativeExecution => ({
      agentType: AgentType.REPLY_UNDERSTANDING,
      source: "REPLY_PROCESSING",
      sourceEntityType: "ReplyProcessingRun",
      sourceEntityId: run.id,
      leadId: run.leadId,
      status: completedStatus(run.status, ["COMPLETED", "SKIPPED"], ["FAILED"]),
      startedAt: run.createdAt,
      completedAt: run.updatedAt,
      summary:
        run.summary ??
        (run.failureMessage
          ? `Reply understanding failed: ${run.failureMessage}`
          : "Reply understanding completed"),
      result: {
        intent: run.intent ?? "UNKNOWN",
        recommendedAction: run.recommendedAction ?? "UNKNOWN",
        requiresHumanReview: run.requiresHumanReview
      }
    })),
    ...scores.map((run): NativeExecution => ({
      agentType: AgentType.QUALIFICATION,
      source: "SCORING_ENGINE",
      sourceEntityType: "LeadScoreRun",
      sourceEntityId: run.id,
      leadId: run.leadId,
      status: completedStatus(run.status, ["COMPLETED", "SKIPPED"], ["FAILED"]),
      startedAt: run.createdAt,
      completedAt: run.createdAt,
      summary:
        run.reason ??
        (run.score === null
          ? "Qualification evaluation completed"
          : `Qualification score evaluated at ${String(run.score)}`),
      result: {
        score: run.score ?? 0,
        temperature: run.temperature ?? "NURTURE",
        source: run.source
      }
    })),
    ...proposals.map((run): NativeExecution => ({
      agentType: AgentType.PROPOSAL,
      source: "PROPOSAL_GENERATION",
      sourceEntityType: "ProposalGenerationRun",
      sourceEntityId: run.id,
      leadId: run.leadId,
      status: completedStatus(run.status, ["COMPLETED", "NEEDS_INPUT"], ["FAILED"]),
      startedAt: run.createdAt,
      completedAt: run.updatedAt,
      summary:
        run.status === "FAILED"
          ? `Proposal generation failed: ${run.failureMessage ?? "Unknown error"}`
          : run.status === "NEEDS_INPUT"
            ? "Proposal generation needs additional input"
            : "Proposal generated successfully",
      result: { kind: run.kind, status: run.status, proposalId: run.proposalId ?? "" }
    })),
    ...meetings.map((run): NativeExecution => ({
      agentType: AgentType.MEETING,
      source: "MEETING_SERVICE",
      sourceEntityType: "MeetingRequest",
      sourceEntityId: run.id,
      leadId: run.leadId,
      status: completedStatus(run.status, ["CONFIRMED"], ["CANCELLED", "ATTENTION_REQUIRED"]),
      startedAt: run.createdAt,
      completedAt: run.confirmedAt,
      summary:
        run.status === "CONFIRMED"
          ? `Meeting confirmed: ${run.title}`
          : run.status === "CONFIRMATION_REQUIRED"
            ? `Meeting awaiting confirmation: ${run.title}`
            : run.status === "PROVIDER_PENDING"
              ? `Meeting provider sync pending: ${run.title}`
              : run.status === "ATTENTION_REQUIRED"
                ? `Meeting needs attention: ${run.title}`
                : `Meeting canceled: ${run.title}`,
      result: {
        status: run.status,
        provider: run.provider,
        providerSyncStatus: run.providerSyncStatus
      }
    })),
    ...voices.map((run): NativeExecution => ({
      agentType: AgentType.VOICE,
      source: "VOICE_AI",
      sourceEntityType: "VoiceConversationRun",
      sourceEntityId: run.id,
      leadId: run.leadId,
      status: completedStatus(run.status, ["COMPLETED"], ["FAILED"]),
      startedAt: run.startedAt,
      completedAt: run.completedAt,
      summary:
        run.summary ??
        (run.failureMessage
          ? `Voice conversation failed: ${run.failureMessage}`
          : "Voice conversation in progress"),
      result: {
        status: run.status,
        intent: run.intent ?? "UNKNOWN",
        recommendedAction: run.recommendedAction ?? "UNKNOWN"
      }
    })),
    ...whatsapps.map((run): NativeExecution => ({
      agentType: AgentType.WHATSAPP,
      source: "WHATSAPP_PROVIDER",
      sourceEntityType: "OutboundWhatsAppMessage",
      sourceEntityId: run.id,
      leadId: run.leadId,
      status: completedStatus(
        run.status,
        ["SENT", "DELIVERED", "READ"],
        ["FAILED", "BLOCKED", "NOT_CONFIGURED"]
      ),
      startedAt: run.requestedAt,
      completedAt: run.readAt ?? run.deliveredAt ?? run.sentAt ?? run.failedAt,
      summary: ["FAILED", "BLOCKED", "NOT_CONFIGURED"].includes(run.status)
        ? `WhatsApp delivery needs attention: ${run.failureMessage ?? "Provider configuration required"}`
        : `WhatsApp message ${run.status.toLowerCase().replaceAll("_", " ")}`,
      result: { status: run.status, provider: run.provider }
    })),
    ...briefings.map((run): NativeExecution => ({
      agentType: AgentType.SALES_COPILOT,
      source: "BRIEFING_SERVICE",
      sourceEntityType: "BriefingRun",
      sourceEntityId: run.id,
      leadId: run.leadId,
      status: completedStatus(run.status, ["COMPLETED"], ["FAILED"]),
      startedAt: run.createdAt,
      completedAt: run.updatedAt,
      summary:
        run.summary ??
        (run.failureMessage
          ? `Briefing failed: ${run.failureMessage}`
          : "Sales briefing generated"),
      result: { kind: run.kind, recommendedNextAction: run.recommendedNextAction ?? "" }
    }))
  ];
}

async function synchronizeExecutions(workspaceId: string): Promise<void> {
  const agents = await prisma.agent.findMany({
    where: { workspaceId, status: AgentStatus.ACTIVE },
    include: { currentVersion: true }
  });
  const byType = new Map(
    agents.filter((agent) => agent.currentVersion).map((agent) => [agent.type, agent])
  );
  const native = await nativeExecutions(workspaceId);
  for (const execution of native) {
    const agent = byType.get(execution.agentType);
    if (!agent?.currentVersion) continue;
    const durationMs = execution.completedAt
      ? Math.max(0, execution.completedAt.getTime() - execution.startedAt.getTime())
      : null;
    await prisma.agentExecution.upsert({
      where: {
        workspaceId_agentId_sourceEntityType_sourceEntityId: {
          workspaceId,
          agentId: agent.id,
          sourceEntityType: execution.sourceEntityType,
          sourceEntityId: execution.sourceEntityId
        }
      },
      create: {
        workspaceId,
        agentId: agent.id,
        versionId: agent.currentVersion.id,
        source: execution.source,
        sourceEntityType: execution.sourceEntityType,
        sourceEntityId: execution.sourceEntityId,
        entityType: execution.leadId ? "LEAD" : null,
        entityId: execution.leadId,
        leadId: execution.leadId,
        status: execution.status,
        startedAt: execution.startedAt,
        completedAt: execution.completedAt,
        durationMs,
        summary: execution.summary,
        result: execution.result,
        evaluation: {
          outcome:
            execution.status === AgentExecutionStatus.FAILED
              ? "FAILED"
              : execution.status === AgentExecutionStatus.SUCCEEDED
                ? "PASSED"
                : "PENDING"
        },
        correlationId: `${execution.sourceEntityType}:${execution.sourceEntityId}`
      },
      update: {
        status: execution.status,
        completedAt: execution.completedAt,
        durationMs,
        summary: execution.summary,
        result: execution.result,
        evaluation: {
          outcome:
            execution.status === AgentExecutionStatus.FAILED
              ? "FAILED"
              : execution.status === AgentExecutionStatus.SUCCEEDED
                ? "PASSED"
                : "PENDING"
        }
      }
    });
  }
}

async function loadAgents(workspaceId: string): Promise<AgentRecord[]> {
  return prisma.agent.findMany({
    where: { workspaceId },
    include: agentInclude,
    orderBy: [{ status: "asc" }, { name: "asc" }]
  });
}

export async function listAgents(actor: AuthenticatedUser): Promise<AgentDashboardDto> {
  const workspaceId = workspaceIdFor(actor);
  await ensureCapabilityAgents(workspaceId);
  await synchronizeExecutions(workspaceId);
  const [agents, executions] = await Promise.all([
    loadAgents(workspaceId),
    prisma.agentExecution.findMany({ where: { workspaceId }, orderBy: { startedAt: "desc" } })
  ]);
  const dtos = agents.map((agent) => agentDto(agent, executions));
  const successful = executions.filter(
    (execution) => execution.status === AgentExecutionStatus.SUCCEEDED
  ).length;
  const failed = executions.filter(
    (execution) => execution.status === AgentExecutionStatus.FAILED
  ).length;
  return {
    agents: dtos,
    summary: {
      totalAgents: agents.length,
      activeAgents: agents.filter((agent) => agent.status === AgentStatus.ACTIVE).length,
      pausedAgents: agents.filter((agent) => agent.status === AgentStatus.PAUSED).length,
      totalExecutions: executions.length,
      successfulExecutions: successful,
      failedExecutions: failed,
      successRate:
        successful + failed > 0
          ? Math.round((successful / (successful + failed)) * 1000) / 10
          : null
    }
  };
}

async function findAgent(workspaceId: string, agentId: string): Promise<AgentRecord> {
  const agent = await prisma.agent.findFirst({
    where: { id: agentId, workspaceId },
    include: agentInclude
  });
  if (!agent) throw new AppError(404, "NOT_FOUND", "Agent not found");
  return agent;
}

export async function getAgent(
  actor: AuthenticatedUser,
  agentId: string,
  query: ListAgentExecutionsQuery = { limit: 50 }
): Promise<AgentDetailDto> {
  const workspaceId = workspaceIdFor(actor);
  await ensureCapabilityAgents(workspaceId);
  await synchronizeExecutions(workspaceId);
  const agent = await findAgent(workspaceId, agentId);
  const executions = await prisma.agentExecution.findMany({
    where: { workspaceId, agentId, status: query.status },
    orderBy: { startedAt: "desc" },
    take: query.limit
  });
  return { ...agentDto(agent, executions), executions: executions.map(executionDto) };
}

async function audit(
  workspaceId: string,
  actor: AuthenticatedUser,
  agentId: string,
  action: string,
  before: Prisma.InputJsonValue | undefined,
  after: Prisma.InputJsonValue
): Promise<void> {
  await prisma.auditEvent.create({
    data: {
      workspaceId,
      actorType: "USER",
      actorId: actor.id,
      actorUserId: actor.id,
      sourceType: "AGENTS",
      entityType: "Agent",
      entityId: agentId,
      action,
      before,
      after
    }
  });
}

function nullableJson(
  value: Record<string, unknown> | null | undefined
): Prisma.InputJsonValue | typeof Prisma.JsonNull | undefined {
  if (value === undefined) return undefined;
  return value === null ? Prisma.JsonNull : (value as Prisma.InputJsonObject);
}

export async function createAgent(
  actor: AuthenticatedUser,
  input: CreateAgentInput
): Promise<AgentDetailDto> {
  assertCanManage(actor);
  const workspaceId = workspaceIdFor(actor);
  const key = `custom-${randomUUID()}`;
  const agent = await prisma.$transaction(async (tx) => {
    const created = await tx.agent.create({
      data: {
        workspaceId,
        key,
        name: input.name,
        description: input.description,
        type: input.type,
        createdByUserId: actor.id
      }
    });
    const version = await tx.agentVersion.create({
      data: {
        agentId: created.id,
        version: 1,
        definition: input.definition as Prisma.InputJsonObject,
        modelConfig: nullableJson(input.modelConfig),
        toolsConfig: nullableJson(input.toolsConfig),
        knowledgeConfig: nullableJson(input.knowledgeConfig)
      }
    });
    return tx.agent.update({
      where: { id: created.id },
      data: { currentVersionId: version.id },
      include: agentInclude
    });
  });
  await audit(workspaceId, actor, agent.id, "AGENT_CREATED", undefined, {
    name: agent.name,
    type: agent.type,
    status: agent.status
  });
  await publishRealtimeEvent({ workspaceId, entityType: "agent", action: "agent-created" });
  return { ...agentDto(agent, []), executions: [] };
}

export async function updateAgent(
  actor: AuthenticatedUser,
  agentId: string,
  input: UpdateAgentInput
): Promise<AgentDetailDto> {
  assertCanManage(actor);
  const workspaceId = workspaceIdFor(actor);
  const existing = await findAgent(workspaceId, agentId);
  if (existing.status === AgentStatus.ARCHIVED)
    throw new AppError(409, "CONFLICT", "Archived agents cannot be edited");
  const current = existing.currentVersion;
  if (!current) throw new AppError(409, "CONFLICT", "Agent has no current version");
  const published = existing.status !== AgentStatus.DRAFT;
  const updated = await prisma.$transaction(async (tx) => {
    const version = await tx.agentVersion.create({
      data: {
        agentId,
        version: (existing.versions[0]?.version ?? 0) + 1,
        definition: (input.definition ?? current.definition) as Prisma.InputJsonValue,
        modelConfig:
          input.modelConfig === undefined
            ? (current.modelConfig ?? Prisma.JsonNull)
            : nullableJson(input.modelConfig),
        toolsConfig:
          input.toolsConfig === undefined
            ? (current.toolsConfig ?? Prisma.JsonNull)
            : nullableJson(input.toolsConfig),
        knowledgeConfig:
          input.knowledgeConfig === undefined
            ? (current.knowledgeConfig ?? Prisma.JsonNull)
            : nullableJson(input.knowledgeConfig),
        publishedAt: published ? new Date() : null,
        publishedByUserId: published ? actor.id : null
      }
    });
    return tx.agent.update({
      where: { id: agentId },
      data: { name: input.name, description: input.description, currentVersionId: version.id },
      include: agentInclude
    });
  });
  await audit(
    workspaceId,
    actor,
    agentId,
    "AGENT_UPDATED",
    { name: existing.name, description: existing.description, version: current.version },
    {
      name: updated.name,
      description: updated.description,
      version: updated.currentVersion?.version ?? 0
    }
  );
  await publishRealtimeEvent({ workspaceId, entityType: "agent", action: "agent-updated" });
  const executions = await prisma.agentExecution.findMany({
    where: { workspaceId, agentId },
    orderBy: { startedAt: "desc" },
    take: 50
  });
  return { ...agentDto(updated, executions), executions: executions.map(executionDto) };
}

export async function updateAgentStatus(
  actor: AuthenticatedUser,
  agentId: string,
  input: UpdateAgentStatusInput
): Promise<AgentDetailDto> {
  assertCanManage(actor);
  const workspaceId = workspaceIdFor(actor);
  const existing = await findAgent(workspaceId, agentId);
  if (existing.status === AgentStatus.ARCHIVED)
    throw new AppError(409, "CONFLICT", "Archived agents cannot be resumed");
  if (input.status === AgentStatus.PAUSED && existing.status !== AgentStatus.ACTIVE)
    throw new AppError(409, "CONFLICT", "Only active agents can be paused");
  if (
    input.status === AgentStatus.ACTIVE &&
    existing.status !== AgentStatus.DRAFT &&
    existing.status !== AgentStatus.PAUSED
  )
    throw new AppError(409, "CONFLICT", "Only draft or paused agents can be activated");
  const now = new Date();
  const updated = await prisma.$transaction(async (tx) => {
    if (
      input.status === AgentStatus.ACTIVE &&
      existing.currentVersion &&
      !existing.currentVersion.publishedAt
    ) {
      await tx.agentVersion.update({
        where: { id: existing.currentVersion.id },
        data: { publishedAt: now, publishedByUserId: actor.id }
      });
    }
    return tx.agent.update({
      where: { id: agentId },
      data: { status: input.status },
      include: agentInclude
    });
  });
  await audit(
    workspaceId,
    actor,
    agentId,
    `AGENT_${input.status}`,
    { status: existing.status },
    { status: updated.status }
  );
  await publishRealtimeEvent({
    workspaceId,
    entityType: "agent",
    action: `agent-${input.status.toLowerCase()}`
  });
  const executions = await prisma.agentExecution.findMany({
    where: { workspaceId, agentId },
    orderBy: { startedAt: "desc" },
    take: 50
  });
  return { ...agentDto(updated, executions), executions: executions.map(executionDto) };
}

export async function assertAgentCapabilityActive(
  workspaceId: string,
  type: AgentType
): Promise<void> {
  const agents = await prisma.agent.findMany({
    where: { workspaceId, type },
    select: { status: true }
  });
  if (agents.length > 0 && !agents.some((agent) => agent.status === AgentStatus.ACTIVE)) {
    throw new AppError(409, "CONFLICT", `${type.replaceAll("_", " ")} agent is paused`);
  }
}
