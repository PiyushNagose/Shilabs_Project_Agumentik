import { Prisma } from "@prisma/client";
import type {
  AgentComposerDefinitionDto,
  AgentComposerEdgeDto,
  AgentComposerNodeDto
} from "@shilabs/shared-types";
import { PermanentDomainEventError } from "../domain-events/domain-event.errors.js";
import { workerPrisma } from "../domain-events/domain-event.repository.js";

type RuntimeLead = NonNullable<Awaited<ReturnType<typeof loadLead>>>;
type RuntimeOutcome = "COMPLETED" | "WAITING" | "HUMAN_REQUIRED";

interface RuntimeStep {
  order: number;
  nodeId: string;
  nodeType: string;
  label: string;
  outcome: string;
  branch?: string;
}

interface RuntimeContext {
  steps: RuntimeStep[];
  latestMessage: string;
  parentWorkflowExecutionId?: string;
  parentWorkflowNodeId?: string;
}

export interface AgentRuntimeAdapters {
  createTask(input: {
    executionId: string;
    node: AgentComposerNodeDto;
    title: string;
  }): Promise<void>;
  queueCommunication(input: {
    executionId: string;
    node: AgentComposerNodeDto;
    channel: "EMAIL" | "WHATSAPP" | "VOICE";
    subject: string;
    message: string;
  }): Promise<void>;
  updateLead(input: {
    executionId: string;
    node: AgentComposerNodeDto;
    changes: Record<string, string | number | null>;
  }): Promise<void>;
  assignOwner(input: {
    executionId: string;
    node: AgentComposerNodeDto;
    ownerId: string;
  }): Promise<void>;
}

export interface InvokePublishedAgentInput {
  workspaceId: string;
  agentId: string;
  leadId: string;
  source: string;
  sourceEntityType: string;
  sourceEntityId: string;
  correlationId: string;
  parentWorkflowExecutionId?: string;
  parentWorkflowNodeId?: string;
  adapters: AgentRuntimeAdapters;
}

export interface AgentRuntimeResult {
  executionId: string;
  outcome: RuntimeOutcome;
  summary: string;
  nextRunAt?: Date;
}

function runtimeError(code: string, message: string): PermanentDomainEventError {
  return new PermanentDomainEventError(code, message);
}

function configString(node: AgentComposerNodeDto, key: string): string {
  const value = node.config[key];
  return typeof value === "string" ? value.trim() : "";
}

function definitionFrom(value: Prisma.JsonValue): AgentComposerDefinitionDto {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    value.kind !== "AGENT_COMPOSER" ||
    !Array.isArray(value.nodes) ||
    !Array.isArray(value.edges)
  )
    throw runtimeError("AGENT_DEFINITION_INVALID", "Published agent has no executable definition");
  return value as unknown as AgentComposerDefinitionDto;
}

function nextEdge(
  edges: AgentComposerEdgeDto[],
  nodeId: string,
  branch?: string
): AgentComposerEdgeDto | undefined {
  const candidates = edges.filter((edge) => edge.source === nodeId);
  if (!branch) return candidates.length === 1 ? candidates[0] : undefined;
  return (
    candidates.find((edge) => edge.branch?.toLowerCase() === branch.toLowerCase()) ??
    candidates.find((edge) => edge.branch?.toLowerCase() === "default")
  );
}

async function loadLead(workspaceId: string, leadId: string) {
  return workerPrisma.lead.findFirst({
    where: { id: leadId, workspaceId },
    include: { contact: true, company: true }
  });
}

function assertAutomationAllowed(lead: RuntimeLead): void {
  if (lead.contact.doNotContact)
    throw runtimeError("DO_NOT_CONTACT", "Contact does not permit automated communication");
  if (["WON", "LOST", "DISQUALIFIED"].includes(lead.status))
    throw runtimeError("LEAD_TERMINAL", "Lead is already in a terminal state");
  if (lead.automationOwnershipState !== "AI_ACTIVE")
    throw runtimeError("AGENT_OWNERSHIP_BLOCKED", "Lead is not available for AI automation");
}

function leadValue(lead: RuntimeLead, field: string): string | number | boolean | null {
  const values: Record<string, string | number | boolean | null> = {
    "lead.score": lead.score,
    "lead.source": lead.source,
    "lead.status": lead.status,
    "lead.stageId": lead.stageId,
    "lead.temperature": lead.temperature,
    "lead.serviceInterest": lead.serviceInterest,
    "lead.requirement": lead.requirement,
    "lead.automationOwnershipState": lead.automationOwnershipState,
    "contact.doNotContact": lead.contact.doNotContact,
    "company.location": lead.company.location
  };
  return values[field] ?? null;
}

function scalar(value: string): string | number | boolean {
  if (/^-?\d+(?:\.\d+)?$/.test(value)) return Number(value);
  if (value.toLowerCase() === "true") return true;
  if (value.toLowerCase() === "false") return false;
  return value.replace(/^['"]|['"]$/g, "");
}

function evaluateCondition(node: AgentComposerNodeDto, lead: RuntimeLead): boolean {
  let field = configString(node, "field");
  let operator = configString(node, "operator") || "==";
  let expected = node.config.value as string | number | boolean | null | undefined;
  if (!field) {
    const match =
      /^((?:lead|contact|company)\.[A-Za-z][A-Za-z0-9]*)\s*(===|==|!==|!=|>=|<=|>|<)\s*(.+)$/.exec(
        configString(node, "expression")
      );
    if (!match)
      throw runtimeError(
        "AGENT_CONDITION_UNSUPPORTED",
        `${node.label} must use an approved CRM comparison`
      );
    field = match[1] ?? "";
    operator = match[2] ?? "==";
    expected = scalar((match[3] ?? "").trim());
  }
  const actual = leadValue(lead, field);
  if (actual === null || expected === null || expected === undefined)
    throw runtimeError(
      "AGENT_CONDITION_VALUE_MISSING",
      `${node.label} references unavailable data`
    );
  if ([">", ">=", "<", "<="].includes(operator)) {
    const left = Number(actual);
    const right = Number(expected);
    if (!Number.isFinite(left) || !Number.isFinite(right))
      throw runtimeError("AGENT_CONDITION_TYPE_INVALID", `${node.label} requires numeric values`);
    if (operator === ">") return left > right;
    if (operator === ">=") return left >= right;
    if (operator === "<") return left < right;
    return left <= right;
  }
  const equal = String(actual).toLowerCase() === String(expected).toLowerCase();
  return operator === "!=" || operator === "!==" ? !equal : equal;
}

function decisionBranch(node: AgentComposerNodeDto, edges: AgentComposerEdgeDto[]): string {
  const branches = edges
    .filter((edge) => edge.source === node.id)
    .map((edge) => edge.branch)
    .filter((branch): branch is string => Boolean(branch));
  const configured = configString(node, "branch") || configString(node, "defaultBranch");
  if (configured && branches.some((branch) => branch.toLowerCase() === configured.toLowerCase()))
    return configured;
  const safeBranch = branches.find((branch) => {
    const normalized = branch.toLowerCase();
    return (
      ["false", "default"].includes(normalized) ||
      ["human", "person", "review", "stop", "blocked", "reject"].some((word) =>
        normalized.includes(word)
      )
    );
  });
  if (safeBranch) return safeBranch;
  throw runtimeError("AGENT_DECISION_ROUTE_MISSING", `${node.label} has no safe persisted branch`);
}

function contextFrom(value: Prisma.JsonValue | null): RuntimeContext {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return { steps: [], latestMessage: "" };
  return {
    steps: (Array.isArray(value.steps) ? value.steps : []) as unknown as RuntimeStep[],
    latestMessage: typeof value.latestMessage === "string" ? value.latestMessage : "",
    ...(typeof value.parentWorkflowExecutionId === "string"
      ? { parentWorkflowExecutionId: value.parentWorkflowExecutionId }
      : {}),
    ...(typeof value.parentWorkflowNodeId === "string"
      ? { parentWorkflowNodeId: value.parentWorkflowNodeId }
      : {})
  };
}

function contextJson(context: RuntimeContext): Prisma.InputJsonObject {
  return {
    steps: context.steps as unknown as Prisma.InputJsonArray,
    latestMessage: context.latestMessage,
    ...(context.parentWorkflowExecutionId
      ? { parentWorkflowExecutionId: context.parentWorkflowExecutionId }
      : {}),
    ...(context.parentWorkflowNodeId ? { parentWorkflowNodeId: context.parentWorkflowNodeId } : {})
  };
}

function leadChanges(node: AgentComposerNodeDto): Record<string, string | number | null> {
  const changes: Record<string, string | number | null> = {};
  for (const key of [
    "status",
    "stageId",
    "score",
    "temperature",
    "requirement",
    "serviceInterest",
    "nextAction"
  ]) {
    const value = node.config[key];
    if (typeof value === "string" || typeof value === "number" || value === null)
      changes[key] = value;
  }
  if (Object.keys(changes).length === 0)
    throw runtimeError("AGENT_LEAD_UPDATE_EMPTY", `${node.label} has no approved lead changes`);
  return changes;
}

async function markHumanRequired(input: {
  workspaceId: string;
  lead: RuntimeLead;
  executionId: string;
  correlationId: string;
  reason: string;
}): Promise<void> {
  await workerPrisma.$transaction(async (tx) => {
    const current = await tx.lead.findFirst({
      where: { id: input.lead.id, workspaceId: input.workspaceId }
    });
    if (!current) throw runtimeError("LEAD_NOT_FOUND", "Agent lead is unavailable");
    await tx.lead.update({
      where: { id: current.id },
      data: {
        automationOwnershipState: "HUMAN_REQUIRED",
        automationOwnershipReason: input.reason,
        automationOwnershipChangedAt: new Date(),
        lastActivityAt: new Date()
      }
    });
    const existing = await tx.activity.findFirst({
      where: {
        sourceType: "AGENT_EXECUTION",
        sourceId: input.executionId,
        type: "AUTOMATION_OWNERSHIP_CHANGED"
      }
    });
    if (!existing)
      await tx.activity.create({
        data: {
          workspaceId: input.workspaceId,
          leadId: current.id,
          entityType: "AGENT",
          entityId: input.executionId,
          actorType: "AGENT",
          sourceType: "AGENT_EXECUTION",
          sourceId: input.executionId,
          type: "AUTOMATION_OWNERSHIP_CHANGED",
          title: "Human action required",
          description: input.reason,
          metadata: { from: current.automationOwnershipState, to: "HUMAN_REQUIRED" },
          correlationId: input.correlationId,
          visibility: "BUSINESS"
        }
      });
  });
}

async function scheduleParentResume(input: {
  workspaceId: string;
  workflowExecutionId?: string;
  workflowNodeId?: string;
  leadId: string;
  correlationId: string;
}): Promise<void> {
  if (!input.workflowExecutionId || !input.workflowNodeId) return;
  const key = `agent:${input.workflowExecutionId}:${input.workflowNodeId}:completed`;
  await workerPrisma.domainEventOutbox.upsert({
    where: { idempotencyKey: key },
    update: {},
    create: {
      workspaceId: input.workspaceId,
      eventType: "WORKFLOW_EXECUTION_RESUME",
      aggregateType: "WorkflowExecution",
      aggregateId: input.workflowExecutionId,
      payload: { workflowExecutionId: input.workflowExecutionId, leadId: input.leadId },
      correlationId: input.correlationId,
      idempotencyKey: key
    }
  });
}

async function failExecution(input: {
  executionId: string;
  startedAt: Date;
  error: unknown;
  context: RuntimeContext;
  nodeId: string | null;
}): Promise<never> {
  const code =
    input.error instanceof PermanentDomainEventError ? input.error.code : "AGENT_RUNTIME_FAILED";
  const message = input.error instanceof Error ? input.error.message : "Agent execution failed";
  const completedAt = new Date();
  await workerPrisma.agentExecution.update({
    where: { id: input.executionId },
    data: {
      status: "FAILED",
      currentNodeId: input.nodeId,
      nextRunAt: null,
      completedAt,
      durationMs: completedAt.getTime() - input.startedAt.getTime(),
      summary: message,
      result: { ...contextJson(input.context), failedNodeId: input.nodeId },
      evaluation: { outcome: "FAILED", code, message }
    }
  });
  throw input.error instanceof Error ? input.error : runtimeError(code, message);
}

export async function invokePublishedAgent(
  input: InvokePublishedAgentInput
): Promise<AgentRuntimeResult> {
  const agent = await workerPrisma.agent.findFirst({
    where: { id: input.agentId, workspaceId: input.workspaceId, status: "ACTIVE" },
    include: { currentVersion: true }
  });
  if (!agent?.currentVersion?.publishedAt)
    throw runtimeError("AGENT_NOT_AVAILABLE", "Agent has no active published version");

  let execution = await workerPrisma.agentExecution.upsert({
    where: {
      workspaceId_agentId_sourceEntityType_sourceEntityId: {
        workspaceId: input.workspaceId,
        agentId: agent.id,
        sourceEntityType: input.sourceEntityType,
        sourceEntityId: input.sourceEntityId
      }
    },
    update: {},
    create: {
      workspaceId: input.workspaceId,
      agentId: agent.id,
      versionId: agent.currentVersion.id,
      source: input.source,
      sourceEntityType: input.sourceEntityType,
      sourceEntityId: input.sourceEntityId,
      entityType: "Lead",
      entityId: input.leadId,
      leadId: input.leadId,
      correlationId: input.correlationId,
      result: contextJson({
        steps: [],
        latestMessage: "",
        ...(input.parentWorkflowExecutionId
          ? { parentWorkflowExecutionId: input.parentWorkflowExecutionId }
          : {}),
        ...(input.parentWorkflowNodeId ? { parentWorkflowNodeId: input.parentWorkflowNodeId } : {})
      })
    }
  });
  if (execution.status === "SUCCEEDED")
    return {
      executionId: execution.id,
      outcome: "COMPLETED",
      summary: execution.summary ?? "Completed"
    };
  if (execution.status === "HUMAN_REQUIRED")
    return {
      executionId: execution.id,
      outcome: "HUMAN_REQUIRED",
      summary: execution.summary ?? "Human action is required"
    };
  if (execution.status === "FAILED")
    throw runtimeError("AGENT_EXECUTION_FAILED", execution.summary ?? "Agent execution failed");
  if (execution.status === "WAITING" && execution.nextRunAt && execution.nextRunAt > new Date())
    return {
      executionId: execution.id,
      outcome: "WAITING",
      summary: execution.summary ?? "Agent is waiting",
      nextRunAt: execution.nextRunAt
    };

  const claimed = await workerPrisma.agentExecution.updateMany({
    where: { id: execution.id, status: { in: ["QUEUED", "WAITING"] } },
    data: { status: "RUNNING", nextRunAt: null }
  });
  if (claimed.count !== 1)
    throw runtimeError("AGENT_EXECUTION_IN_PROGRESS", "Agent execution is already running");
  execution = await workerPrisma.agentExecution.findUniqueOrThrow({ where: { id: execution.id } });
  const context = contextFrom(execution.result);
  context.parentWorkflowExecutionId ??= input.parentWorkflowExecutionId;
  context.parentWorkflowNodeId ??= input.parentWorkflowNodeId;
  let currentNodeId = execution.currentNodeId;

  try {
    const version = await workerPrisma.agentVersion.findUniqueOrThrow({
      where: { id: execution.versionId }
    });
    const definition = definitionFrom(version.definition);
    let lead = await loadLead(input.workspaceId, input.leadId);
    if (!lead) throw runtimeError("LEAD_NOT_FOUND", "Agent lead is unavailable in this workspace");
    assertAutomationAllowed(lead);
    const nodes = new Map(definition.nodes.map((node) => [node.id, node]));
    let node = execution.currentNodeId
      ? nodes.get(execution.currentNodeId)
      : definition.nodes.find((candidate) => candidate.type === "TRIGGER");
    if (!node) throw runtimeError("AGENT_DEFINITION_INVALID", "Agent has no Trigger node");
    if (execution.currentNodeId) {
      const edge = nextEdge(definition.edges, execution.currentNodeId);
      node = edge ? nodes.get(edge.target) : undefined;
      if (!node) throw runtimeError("AGENT_ROUTE_MISSING", "Wait node has no resume connection");
    }
    const visited = new Set(context.steps.map((step) => step.nodeId));
    let summary = "Completed";

    for (;;) {
      currentNodeId = node.id;
      if (visited.has(node.id) || visited.size >= definition.nodes.length)
        throw runtimeError("AGENT_GRAPH_CYCLE", "Agent graph contains a cycle");
      visited.add(node.id);
      let branch: string | undefined;
      let outcome = "Completed";

      if (node.type === "MESSAGE" || node.type === "QUESTION") {
        context.latestMessage = configString(
          node,
          node.type === "MESSAGE" ? "message" : "question"
        );
        if (!context.latestMessage)
          throw runtimeError("AGENT_MESSAGE_MISSING", `${node.label} has no approved content`);
        outcome = node.type === "MESSAGE" ? "Approved message prepared" : "Question prepared";
      } else if (node.type === "CONDITION") {
        branch = evaluateCondition(node, lead) ? "true" : "false";
        outcome = `Selected ${branch} branch`;
      } else if (node.type === "AI_DECISION") {
        branch = decisionBranch(node, definition.edges);
        outcome = `Persisted safety policy selected ${branch}`;
      } else if (node.type === "WAIT") {
        const minutes = node.config.durationMinutes;
        if (typeof minutes !== "number" || !Number.isInteger(minutes) || minutes < 1)
          throw runtimeError("AGENT_WAIT_INVALID", `${node.label} has no valid duration`);
        const nextRunAt = new Date(Date.now() + minutes * 60_000);
        context.steps.push({
          order: context.steps.length + 1,
          nodeId: node.id,
          nodeType: node.type,
          label: node.label,
          outcome: `Waiting ${String(minutes)} minute${minutes === 1 ? "" : "s"}`
        });
        const key = `agent:${execution.id}:node:${node.id}:resume`;
        await workerPrisma.$transaction([
          workerPrisma.agentExecution.update({
            where: { id: execution.id },
            data: {
              status: "WAITING",
              currentNodeId: node.id,
              nextRunAt,
              summary: `Waiting until ${nextRunAt.toISOString()}`,
              result: contextJson(context),
              evaluation: { outcome: "WAITING", resumeAt: nextRunAt.toISOString() }
            }
          }),
          workerPrisma.domainEventOutbox.upsert({
            where: { idempotencyKey: key },
            update: {},
            create: {
              workspaceId: input.workspaceId,
              eventType: "AGENT_EXECUTION_RESUME",
              aggregateType: "AgentExecution",
              aggregateId: execution.id,
              payload: { agentExecutionId: execution.id, leadId: input.leadId },
              correlationId: input.correlationId,
              idempotencyKey: key,
              nextAttemptAt: nextRunAt
            }
          })
        ]);
        return {
          executionId: execution.id,
          outcome: "WAITING",
          summary: `Waiting until ${nextRunAt.toISOString()}`,
          nextRunAt
        };
      } else if (node.type === "HUMAN_HANDOFF") {
        const reason = configString(node, "reason") || "Human judgment is required";
        await input.adapters.createTask({
          executionId: execution.id,
          node,
          title: configString(node, "title") || node.label
        });
        await markHumanRequired({
          workspaceId: input.workspaceId,
          lead,
          executionId: execution.id,
          correlationId: input.correlationId,
          reason
        });
        context.steps.push({
          order: context.steps.length + 1,
          nodeId: node.id,
          nodeType: node.type,
          label: node.label,
          outcome: "Human task created and automation paused"
        });
        await workerPrisma.agentExecution.update({
          where: { id: execution.id },
          data: {
            status: "HUMAN_REQUIRED",
            currentNodeId: node.id,
            summary: reason,
            result: contextJson(context),
            evaluation: { outcome: "HUMAN_REQUIRED", reason }
          }
        });
        return { executionId: execution.id, outcome: "HUMAN_REQUIRED", summary: reason };
      } else if (node.type === "TOOL_CRM_ACTION") {
        assertAutomationAllowed(lead);
        const capability = configString(node, "capability");
        if (capability === "create-task") {
          await input.adapters.createTask({
            executionId: execution.id,
            node,
            title: configString(node, "title") || node.label
          });
          outcome = "Task created";
        } else if (capability === "outreach") {
          if (!context.latestMessage)
            throw runtimeError("AGENT_MESSAGE_MISSING", "Outreach requires approved content");
          await input.adapters.queueCommunication({
            executionId: execution.id,
            node,
            channel: "EMAIL",
            subject: configString(node, "subject") || "Following up on your request",
            message: context.latestMessage
          });
          outcome = "Email queued through the configured provider";
        } else if (capability === "update-lead") {
          await input.adapters.updateLead({
            executionId: execution.id,
            node,
            changes: leadChanges(node)
          });
          lead = (await loadLead(input.workspaceId, input.leadId)) ?? lead;
          outcome = "Lead updated";
        } else if (capability === "assign-owner") {
          const ownerId = configString(node, "ownerId");
          if (!ownerId) throw runtimeError("AGENT_OWNER_MISSING", `${node.label} has no owner`);
          await input.adapters.assignOwner({ executionId: execution.id, node, ownerId });
          lead = (await loadLead(input.workspaceId, input.leadId)) ?? lead;
          outcome = "Lead owner assigned";
        } else {
          throw runtimeError(
            "AGENT_CAPABILITY_UNAVAILABLE",
            `Capability ${capability || node.label} has no worker-safe command adapter`
          );
        }
      } else if (node.type === "INTEGRATION_ACTION") {
        assertAutomationAllowed(lead);
        const capability = configString(node, "capability");
        const channel =
          capability === "email"
            ? "EMAIL"
            : capability === "whatsapp"
              ? "WHATSAPP"
              : capability === "voice"
                ? "VOICE"
                : null;
        if (!channel)
          throw runtimeError(
            "AGENT_INTEGRATION_UNAVAILABLE",
            `Integration ${capability || node.label} has no worker-safe command adapter`
          );
        if (channel !== "VOICE" && !context.latestMessage)
          throw runtimeError("AGENT_MESSAGE_MISSING", `${channel} requires approved content`);
        await input.adapters.queueCommunication({
          executionId: execution.id,
          node,
          channel,
          subject: configString(node, "subject"),
          message: context.latestMessage
        });
        outcome = `${channel} action queued through the configured provider`;
      } else if (node.type === "END") {
        summary = configString(node, "outcome") || node.label;
        outcome = summary;
      }

      context.steps.push({
        order: context.steps.length + 1,
        nodeId: node.id,
        nodeType: node.type,
        label: node.label,
        outcome,
        ...(branch ? { branch } : {})
      });
      if (node.type === "END") break;
      const edge = nextEdge(definition.edges, node.id, branch);
      node = edge ? nodes.get(edge.target) : undefined;
      if (!node)
        throw runtimeError("AGENT_ROUTE_MISSING", "Agent has no executable next connection");
    }

    const completedAt = new Date();
    await workerPrisma.agentExecution.update({
      where: { id: execution.id },
      data: {
        status: "SUCCEEDED",
        currentNodeId,
        nextRunAt: null,
        completedAt,
        durationMs: completedAt.getTime() - execution.startedAt.getTime(),
        summary,
        result: { outcome: "COMPLETED", ...contextJson(context) },
        evaluation: {
          outcome: "PASSED",
          reachedEnd: true,
          traversedNodeCount: context.steps.length
        }
      }
    });
    await scheduleParentResume({
      workspaceId: input.workspaceId,
      workflowExecutionId: context.parentWorkflowExecutionId,
      workflowNodeId: context.parentWorkflowNodeId,
      leadId: input.leadId,
      correlationId: input.correlationId
    });
    return { executionId: execution.id, outcome: "COMPLETED", summary };
  } catch (error) {
    return failExecution({
      executionId: execution.id,
      startedAt: execution.startedAt,
      error,
      context,
      nodeId: currentNodeId
    });
  }
}
