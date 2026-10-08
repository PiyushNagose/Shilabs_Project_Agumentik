import { randomUUID } from "node:crypto";
import { AgentStatus, Prisma } from "@prisma/client";
import type {
  AgentComposerPreviewDto,
  AgentComposerValidationDto,
  AgentDetailDto
} from "@shilabs/shared-types";
import { AppError } from "../../shared/errors.js";
import { prisma } from "../../shared/prisma.js";
import type { AuthenticatedUser } from "../auth/auth.types.js";
import { publishRealtimeEvent } from "../realtime/realtime.service.js";
import type { ComposerDefinitionInput, PreviewAgentComposerInput } from "./agent.schemas.js";
import { assertCanManage, getAgent, workspaceIdFor } from "./agent.service.js";

const reusableCapabilities = new Set([
  "outreach",
  "reply-understanding",
  "qualification",
  "proposal",
  "meeting",
  "voice",
  "whatsapp",
  "sales-copilot",
  "create-task",
  "update-lead",
  "assign-owner"
]);

function textConfig(node: ComposerDefinitionInput["nodes"][number], key: string): string {
  const value = node.config[key];
  return typeof value === "string" ? value.trim() : "";
}

export function validateComposerDefinition(
  definition: ComposerDefinitionInput
): AgentComposerValidationDto {
  const issues: AgentComposerValidationDto["issues"] = [];
  const nodeIds = new Set<string>();
  const edgeIds = new Set<string>();
  const outgoing = new Map<string, ComposerDefinitionInput["edges"]>();

  for (const node of definition.nodes) {
    if (nodeIds.has(node.id))
      issues.push({
        code: "DUPLICATE_NODE_ID",
        message: `Node ID ${node.id} is duplicated.`,
        nodeId: node.id
      });
    nodeIds.add(node.id);
    outgoing.set(node.id, []);
  }
  for (const edge of definition.edges) {
    if (edgeIds.has(edge.id))
      issues.push({
        code: "DUPLICATE_EDGE_ID",
        message: `Edge ID ${edge.id} is duplicated.`,
        nodeId: edge.source
      });
    edgeIds.add(edge.id);
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) {
      issues.push({
        code: "UNKNOWN_EDGE_NODE",
        message: "A connection references a missing node.",
        nodeId: nodeIds.has(edge.source) ? edge.source : null
      });
      continue;
    }
    if (edge.source === edge.target)
      issues.push({
        code: "SELF_CONNECTION",
        message: "A node cannot connect to itself.",
        nodeId: edge.source
      });
    outgoing.get(edge.source)?.push(edge);
  }

  const triggers = definition.nodes.filter((node) => node.type === "TRIGGER");
  const ends = definition.nodes.filter((node) => node.type === "END");
  if (triggers.length !== 1)
    issues.push({
      code: "TRIGGER_COUNT",
      message: "The flow must contain exactly one Trigger.",
      nodeId: triggers[0]?.id ?? null
    });
  if (ends.length === 0)
    issues.push({
      code: "END_REQUIRED",
      message: "The flow must contain at least one End node.",
      nodeId: null
    });

  for (const node of definition.nodes) {
    const next = outgoing.get(node.id) ?? [];
    if (node.type !== "END" && next.length === 0)
      issues.push({
        code: "MISSING_CONNECTION",
        message: `${node.label} must connect to a next node.`,
        nodeId: node.id
      });
    if (node.type === "END" && next.length > 0)
      issues.push({
        code: "END_HAS_CONNECTION",
        message: "End nodes cannot have outgoing connections.",
        nodeId: node.id
      });
    if ((node.type === "CONDITION" || node.type === "AI_DECISION") && next.length < 2)
      issues.push({
        code: "BRANCH_REQUIRED",
        message: `${node.label} requires at least two branches.`,
        nodeId: node.id
      });
    if (next.length > 1) {
      const branches = next.map((edge) => edge.branch?.toLowerCase() ?? "");
      if (branches.some((branch) => !branch) || new Set(branches).size !== branches.length)
        issues.push({
          code: "BRANCH_LABELS",
          message: `${node.label} requires unique labels for every branch.`,
          nodeId: node.id
        });
    }
    const requiredKey =
      node.type === "TRIGGER"
        ? "event"
        : node.type === "MESSAGE"
          ? "message"
          : node.type === "QUESTION"
            ? "question"
            : node.type === "CONDITION"
              ? "expression"
              : node.type === "AI_DECISION"
                ? "instruction"
                : node.type === "HUMAN_HANDOFF"
                  ? "reason"
                  : null;
    if (requiredKey && !textConfig(node, requiredKey))
      issues.push({
        code: "CONFIG_REQUIRED",
        message: `${node.label} requires ${requiredKey} configuration.`,
        nodeId: node.id
      });
    if (node.type === "WAIT") {
      const minutes = node.config.durationMinutes;
      if (
        typeof minutes !== "number" ||
        !Number.isInteger(minutes) ||
        minutes < 1 ||
        minutes > 10080
      )
        issues.push({
          code: "INVALID_WAIT",
          message: "Wait duration must be between 1 and 10,080 minutes.",
          nodeId: node.id
        });
    }
    if (node.type === "TOOL_CRM_ACTION" || node.type === "INTEGRATION_ACTION") {
      const capability = textConfig(node, "capability");
      if (!reusableCapabilities.has(capability))
        issues.push({
          code: "UNSUPPORTED_CAPABILITY",
          message: `${node.label} must use an approved existing capability.`,
          nodeId: node.id
        });
    }
  }

  const trigger = triggers[0];
  if (trigger) {
    const reachable = new Set<string>();
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const cycles = new Set<string>();
    const visit = (id: string): void => {
      if (visiting.has(id)) {
        cycles.add(id);
        return;
      }
      if (visited.has(id)) return;
      visiting.add(id);
      reachable.add(id);
      for (const edge of outgoing.get(id) ?? []) visit(edge.target);
      visiting.delete(id);
      visited.add(id);
    };
    visit(trigger.id);
    if (cycles.size > 0)
      issues.push({
        code: "CYCLE_NOT_ALLOWED",
        message: "Composer flows cannot contain cycles.",
        nodeId: trigger.id
      });
    for (const node of definition.nodes)
      if (!reachable.has(node.id))
        issues.push({
          code: "DISCONNECTED_NODE",
          message: `${node.label} is disconnected from the Trigger.`,
          nodeId: node.id
        });
  }

  return { valid: issues.length === 0, issues };
}

async function scopedAgent(actor: AuthenticatedUser, agentId: string) {
  const workspaceId = workspaceIdFor(actor);
  const agent = await prisma.agent.findFirst({
    where: { id: agentId, workspaceId },
    include: {
      currentVersion: true,
      draftVersion: true,
      versions: { orderBy: { version: "desc" } }
    }
  });
  if (!agent) throw new AppError(404, "NOT_FOUND", "Agent not found");
  return { workspaceId, agent };
}

async function audit(
  actor: AuthenticatedUser,
  workspaceId: string,
  agentId: string,
  action: string,
  after: Prisma.InputJsonObject
): Promise<void> {
  await prisma.auditEvent.create({
    data: {
      workspaceId,
      actorType: "USER",
      actorId: actor.id,
      actorUserId: actor.id,
      sourceType: "AGENT_COMPOSER",
      entityType: "Agent",
      entityId: agentId,
      action,
      after
    }
  });
}

export async function saveAgentComposer(
  actor: AuthenticatedUser,
  agentId: string,
  definition: ComposerDefinitionInput
): Promise<AgentDetailDto> {
  assertCanManage(actor);
  const { workspaceId, agent } = await scopedAgent(actor, agentId);
  if (agent.status === AgentStatus.ARCHIVED)
    throw new AppError(409, "CONFLICT", "Archived agents cannot be edited");
  const base = agent.draftVersion ?? agent.currentVersion;
  const version = await prisma.$transaction(async (tx) => {
    const created = await tx.agentVersion.create({
      data: {
        agentId,
        version: (agent.versions[0]?.version ?? 0) + 1,
        definition: definition as Prisma.InputJsonObject,
        modelConfig: base?.modelConfig ?? Prisma.JsonNull,
        toolsConfig: base?.toolsConfig ?? Prisma.JsonNull,
        knowledgeConfig: base?.knowledgeConfig ?? Prisma.JsonNull
      }
    });
    await tx.agent.update({
      where: { id: agentId },
      data: {
        draftVersionId: created.id,
        currentVersionId: agent.status === AgentStatus.DRAFT ? created.id : undefined
      }
    });
    return created;
  });
  await audit(actor, workspaceId, agentId, "AGENT_COMPOSER_DRAFT_SAVED", {
    version: version.version,
    nodeCount: definition.nodes.length,
    edgeCount: definition.edges.length
  });
  await publishRealtimeEvent({ workspaceId, entityType: "agent", action: "agent-composer-saved" });
  return getAgent(actor, agentId);
}

function persistedDefinition(value: Prisma.JsonValue | undefined): ComposerDefinitionInput {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    value.kind !== "AGENT_COMPOSER"
  )
    throw new AppError(409, "CONFLICT", "Save a Composer draft before continuing");
  return value as unknown as ComposerDefinitionInput;
}

export async function validateAgentComposer(
  actor: AuthenticatedUser,
  agentId: string
): Promise<AgentComposerValidationDto> {
  const { agent } = await scopedAgent(actor, agentId);
  return validateComposerDefinition(
    persistedDefinition((agent.draftVersion ?? agent.currentVersion)?.definition)
  );
}

export async function previewAgentComposer(
  actor: AuthenticatedUser,
  agentId: string,
  input: PreviewAgentComposerInput
): Promise<AgentComposerPreviewDto> {
  const { agent } = await scopedAgent(actor, agentId);
  const definition =
    input.definition ??
    persistedDefinition((agent.draftVersion ?? agent.currentVersion)?.definition);
  const validation = validateComposerDefinition(definition);
  if (!validation.valid)
    return { safe: true, mode: "SANDBOX", validation, steps: [], blockedActions: [] };
  const nodes = new Map(definition.nodes.map((node) => [node.id, node]));
  const outgoing = new Map<string, ComposerDefinitionInput["edges"]>();
  for (const edge of definition.edges)
    outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge]);
  const steps: AgentComposerPreviewDto["steps"] = [];
  const blockedActions: string[] = [];
  let current = definition.nodes.find((node) => node.type === "TRIGGER");
  while (current && steps.length <= definition.nodes.length) {
    const action = current.type === "TOOL_CRM_ACTION" || current.type === "INTEGRATION_ACTION";
    steps.push({
      order: steps.length + 1,
      nodeId: current.id,
      nodeType: current.type,
      label: current.label,
      outcome: action
        ? "Simulated only; no customer or CRM action executed"
        : "Validated in sandbox"
    });
    if (action) {
      const capability = current.config.capability;
      blockedActions.push(typeof capability === "string" ? capability : current.label);
    }
    const next = (outgoing.get(current.id) ?? [])[0];
    current = next ? nodes.get(next.target) : undefined;
  }
  return { safe: true, mode: "SANDBOX", validation, steps, blockedActions };
}

export async function publishAgentComposer(
  actor: AuthenticatedUser,
  agentId: string
): Promise<AgentDetailDto> {
  assertCanManage(actor);
  const { workspaceId, agent } = await scopedAgent(actor, agentId);
  if (agent.status === AgentStatus.ARCHIVED)
    throw new AppError(409, "CONFLICT", "Archived agents cannot be published");
  const draft = agent.draftVersion;
  if (!draft) throw new AppError(409, "CONFLICT", "No unpublished Composer draft exists");
  const validation = validateComposerDefinition(persistedDefinition(draft.definition));
  if (!validation.valid)
    throw new AppError(
      422,
      "VALIDATION_ERROR",
      validation.issues[0]?.message ?? "Composer validation failed",
      { issues: validation.issues }
    );
  const publishedAt = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.agentVersion.update({
      where: { id: draft.id },
      data: { publishedAt, publishedByUserId: actor.id }
    });
    await tx.agent.update({
      where: { id: agentId },
      data: { currentVersionId: draft.id, draftVersionId: null, status: AgentStatus.ACTIVE }
    });
  });
  await audit(actor, workspaceId, agentId, "AGENT_COMPOSER_PUBLISHED", {
    version: draft.version,
    publishedAt: publishedAt.toISOString(),
    correlationId: randomUUID()
  });
  await publishRealtimeEvent({
    workspaceId,
    entityType: "agent",
    action: "agent-composer-published"
  });
  return getAgent(actor, agentId);
}
