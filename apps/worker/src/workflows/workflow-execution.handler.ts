import { LeadStatus, LeadTemperature, Prisma, type DomainEventOutbox } from "@prisma/client";
import { emitOperationalAlert } from "@shilabs/shared-config";
import type {
  AgentComposerNodeDto,
  WorkflowDefinitionDto,
  WorkflowEdgeDto,
  WorkflowNodeDto,
  WorkflowPolicyDto
} from "@shilabs/shared-types";
import { getMessagingConfig, getVoiceConfig } from "@shilabs/shared-config";
import type { DomainEventHandlerMap } from "../domain-events/domain-event.processor.js";
import { PermanentDomainEventError } from "../domain-events/domain-event.errors.js";
import { workerPrisma } from "../domain-events/domain-event.repository.js";
import { assertWorkspaceIntegrationEnabled } from "../integrations/integration-guard.js";
import {
  invokePublishedAgent,
  type AgentRuntimeAdapters
} from "../agents/agent-composer.runtime.js";

function workflowTransaction<T>(
  operation: (tx: Prisma.TransactionClient) => Promise<T>
): Promise<T> {
  return workerPrisma.$transaction(operation, { maxWait: 10_000, timeout: 30_000 });
}

function payloadString(event: DomainEventOutbox, key: string): string | null {
  const value = (event.payload as Prisma.JsonObject)[key];
  return typeof value === "string" && value.trim() ? value : null;
}
function configString(node: WorkflowNodeDto, key: string): string {
  const value = node.config[key];
  return typeof value === "string" ? value.trim() : "";
}
function executionContextValue(
  input: Prisma.JsonValue | null,
  key: string
): Prisma.JsonValue | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) return undefined;
  const root = input;
  const policyContext = root.policyContext;
  if (policyContext && typeof policyContext === "object" && !Array.isArray(policyContext))
    return policyContext[key];
  return root[key];
}

function executionContextBoolean(input: Prisma.JsonValue | null, key: string): boolean {
  const value = executionContextValue(input, key);
  if (typeof value === "boolean") return value;
  return typeof value === "string" && value.toLowerCase() === "true";
}
async function assertIntegrationEnabled(input: {
  workspaceId: string;
  provider: "AWS_SES" | "MAILPIT" | "TWILIO" | "META_WHATSAPP" | "EXOTEL";
  key: string;
}): Promise<void> {
  await assertWorkspaceIntegrationEnabled(input);
}

async function assertCommunicationIntegrationEnabled(
  workspaceId: string,
  channel: string
): Promise<void> {
  if (channel === "EMAIL") {
    const provider = process.env.EMAIL_PROVIDER === "MAILPIT" ? "MAILPIT" : "AWS_SES";
    await assertIntegrationEnabled({ workspaceId, provider, key: "default" });
    return;
  }
  if (channel === "WHATSAPP") {
    const provider = getMessagingConfig().provider;
    if (provider === "meta_whatsapp")
      await assertIntegrationEnabled({ workspaceId, provider: "META_WHATSAPP", key: "default" });
    if (provider === "twilio_whatsapp")
      await assertIntegrationEnabled({ workspaceId, provider: "TWILIO", key: "whatsapp" });
    return;
  }
  if (channel === "VOICE") {
    const provider = getVoiceConfig().provider;
    if (provider === "twilio")
      await assertIntegrationEnabled({ workspaceId, provider: "TWILIO", key: "voice" });
    if (provider === "exotel")
      await assertIntegrationEnabled({ workspaceId, provider: "EXOTEL", key: "voice" });
  }
}
function nextEdge(
  edges: WorkflowEdgeDto[],
  nodeId: string,
  branch?: string
): WorkflowEdgeDto | undefined {
  const candidates = edges.filter((edge) => edge.source === nodeId);
  if (branch)
    return (
      candidates.find((edge) => edge.branch?.toLowerCase() === branch.toLowerCase()) ??
      candidates.find((edge) => edge.branch?.toLowerCase() === "default")
    );
  return candidates[0];
}
function automationBlocked(lead: {
  status: string;
  automationOwnershipState: string;
  contact: { doNotContact: boolean };
}): string | null {
  if (lead.contact.doNotContact) return "DO_NOT_CONTACT";
  if (["WON", "LOST", "DISQUALIFIED"].includes(lead.status)) return `LEAD_${lead.status}`;
  if (lead.automationOwnershipState !== "AI_ACTIVE")
    return `OWNERSHIP_${lead.automationOwnershipState}`;
  return null;
}
function matchesPolicy(
  policy: WorkflowPolicyDto | null,
  lead: {
    source: string;
    requirement: string | null;
    serviceInterest: string | null;
    stageId: string;
    ownerId: string | null;
    company: { location: string | null };
  },
  context: Prisma.JsonObject = {}
): boolean {
  if (!policy) return true;
  const nested = context.policyContext;
  const policyContext =
    nested && typeof nested === "object" && !Array.isArray(nested) ? nested : context;
  const contextValue = (key: string): string | null => {
    const value = policyContext[key];
    return typeof value === "string" && value.trim() ? value : null;
  };
  return (
    (!policy.service || policy.service === (contextValue("service") ?? lead.serviceInterest)) &&
    (!policy.leadType || policy.leadType === (contextValue("leadType") ?? lead.requirement)) &&
    (!policy.source || policy.source === (contextValue("source") ?? lead.source)) &&
    (!policy.priority || policy.priority === contextValue("priority")) &&
    (!policy.country ||
      (contextValue("country") ?? lead.company.location)
        ?.toLowerCase()
        .includes(policy.country.toLowerCase()) === true) &&
    (!policy.managerId || policy.managerId === lead.ownerId) &&
    (!policy.campaign || policy.campaign === contextValue("campaign")) &&
    (!policy.pipelineStageId || policy.pipelineStageId === lead.stageId)
  );
}

async function recordOwnership(input: {
  workspaceId: string;
  leadId: string;
  executionId: string;
  correlationId: string;
  state: "AI_STOPPED" | "HUMAN_REQUIRED";
  reason: string;
}): Promise<void> {
  await workflowTransaction(async (tx) => {
    const lead = await tx.lead.findFirst({
      where: { id: input.leadId, workspaceId: input.workspaceId }
    });
    if (!lead)
      throw new PermanentDomainEventError("LEAD_NOT_FOUND", "Workflow lead is unavailable");
    await tx.lead.update({
      where: { id: lead.id },
      data: {
        automationOwnershipState: input.state,
        automationOwnershipReason: input.reason,
        automationOwnershipChangedAt: new Date(),
        lastActivityAt: new Date()
      }
    });
    await tx.activity.create({
      data: {
        workspaceId: input.workspaceId,
        leadId: lead.id,
        entityType: "WORKFLOW",
        entityId: input.executionId,
        actorType: "WORKFLOW",
        sourceType: "WORKFLOW_EXECUTION",
        sourceId: input.executionId,
        type: "AUTOMATION_OWNERSHIP_CHANGED",
        title: "Automation ownership changed",
        description: `${lead.automationOwnershipState} to ${input.state}: ${input.reason}`,
        metadata: { from: lead.automationOwnershipState, to: input.state, reason: input.reason },
        correlationId: input.correlationId,
        visibility: "BUSINESS"
      }
    });
    await tx.auditEvent.create({
      data: {
        workspaceId: input.workspaceId,
        actorType: "WORKFLOW",
        sourceType: "WORKFLOW_EXECUTION",
        sourceId: input.executionId,
        entityType: "Lead",
        entityId: lead.id,
        action: "AUTOMATION_OWNERSHIP_CHANGED",
        before: { state: lead.automationOwnershipState },
        after: { state: input.state, reason: input.reason },
        correlationId: input.correlationId
      }
    });
  });
}

async function createWorkflowTask(input: {
  workspaceId: string;
  lead: { id: string; contactId: string; companyId: string; ownerId: string | null };
  executionId: string;
  correlationId: string;
  node: WorkflowNodeDto;
  sourceType?: "WORKFLOW_EXECUTION" | "AGENT_EXECUTION";
  resumeOnCompletion?: boolean;
  createdByAgentId?: string;
}): Promise<void> {
  const title = configString(input.node, "title") || input.node.label;
  const dueMinutes =
    typeof input.node.config.dueMinutes === "number" ? input.node.config.dueMinutes : 60;
  const sourceType = input.sourceType ?? "WORKFLOW_EXECUTION";
  const projectionKey = `${sourceType === "AGENT_EXECUTION" ? "agent" : "workflow"}:${input.executionId}:node:${input.node.id}`;
  await workerPrisma.task.upsert({
    where: { projectionKey },
    update: {},
    create: {
      workspaceId: input.workspaceId,
      leadId: input.lead.id,
      contactId: input.lead.contactId,
      companyId: input.lead.companyId,
      title,
      description: configString(input.node, "description") || null,
      priority:
        configString(input.node, "priority") === "URGENT"
          ? "URGENT"
          : configString(input.node, "priority") === "HIGH"
            ? "HIGH"
            : "NORMAL",
      dueAt: new Date(Date.now() + dueMinutes * 60_000),
      assignedToUserId: input.lead.ownerId,
      createdByType: sourceType === "AGENT_EXECUTION" ? "AGENT" : "WORKFLOW",
      createdByAgentId: input.createdByAgentId,
      sourceType,
      sourceId: input.executionId,
      projectionKey,
      metadata: { nodeId: input.node.id, resumeOnCompletion: input.resumeOnCompletion ?? false },
      correlationId: input.correlationId
    }
  });
}

async function updateAgentLead(input: {
  workspaceId: string;
  leadId: string;
  executionId: string;
  correlationId: string;
  node: AgentComposerNodeDto;
  changes: Record<string, string | number | null>;
}): Promise<void> {
  const stageId = typeof input.changes.stageId === "string" ? input.changes.stageId : null;
  if (stageId) {
    const stage = await workerPrisma.pipelineStage.findFirst({
      where: { id: stageId, workspaceId: input.workspaceId, status: "ACTIVE" },
      select: { id: true }
    });
    if (!stage)
      throw new PermanentDomainEventError(
        "AGENT_STAGE_INVALID",
        "Selected pipeline stage is not active in this workspace"
      );
  }
  const data: Prisma.LeadUncheckedUpdateInput = { lastActivityAt: new Date() };
  if (typeof input.changes.status === "string") {
    if (!Object.values(LeadStatus).includes(input.changes.status as LeadStatus))
      throw new PermanentDomainEventError("AGENT_STATUS_INVALID", "Lead status is invalid");
    data.status = input.changes.status as LeadStatus;
  }
  if (typeof input.changes.temperature === "string") {
    if (!Object.values(LeadTemperature).includes(input.changes.temperature as LeadTemperature))
      throw new PermanentDomainEventError(
        "AGENT_TEMPERATURE_INVALID",
        "Lead temperature is invalid"
      );
    data.temperature = input.changes.temperature as LeadTemperature;
  }
  if (typeof input.changes.score === "number") {
    if (
      !Number.isInteger(input.changes.score) ||
      input.changes.score < 0 ||
      input.changes.score > 100
    )
      throw new PermanentDomainEventError(
        "AGENT_SCORE_INVALID",
        "Lead score must be from 0 to 100"
      );
    data.score = input.changes.score;
  }
  if (stageId) data.stageId = stageId;
  for (const key of ["requirement", "serviceInterest", "nextAction"] as const) {
    const value = input.changes[key];
    if (typeof value === "string" || value === null) data[key] = value;
  }
  await workflowTransaction(async (tx) => {
    const lead = await tx.lead.findFirst({
      where: { id: input.leadId, workspaceId: input.workspaceId }
    });
    if (!lead) throw new PermanentDomainEventError("LEAD_NOT_FOUND", "Agent lead is unavailable");
    await tx.lead.update({ where: { id: lead.id }, data });
    const sourceId = `${input.executionId}:${input.node.id}:update-lead`;
    if (!(await tx.activity.findFirst({ where: { sourceType: "AGENT_EXECUTION", sourceId } })))
      await tx.activity.create({
        data: {
          workspaceId: input.workspaceId,
          leadId: lead.id,
          entityType: "AGENT",
          entityId: input.executionId,
          actorType: "AGENT",
          sourceType: "AGENT_EXECUTION",
          sourceId,
          type: "NOTE_ADDED",
          title: "Lead updated by agent",
          description: input.node.label,
          metadata: { changes: input.changes },
          correlationId: input.correlationId,
          visibility: "BUSINESS"
        }
      });
  });
}

async function assignAgentOwner(input: {
  workspaceId: string;
  leadId: string;
  executionId: string;
  correlationId: string;
  node: AgentComposerNodeDto;
  ownerId: string;
}): Promise<void> {
  const member = await workerPrisma.workspaceMember.findFirst({
    where: {
      workspaceId: input.workspaceId,
      userId: input.ownerId,
      status: "ACTIVE",
      user: { status: "ACTIVE" }
    },
    select: { userId: true }
  });
  if (!member)
    throw new PermanentDomainEventError(
      "AGENT_OWNER_INVALID",
      "Selected owner is not an active member of this workspace"
    );
  await workflowTransaction(async (tx) => {
    const lead = await tx.lead.findFirst({
      where: { id: input.leadId, workspaceId: input.workspaceId }
    });
    if (!lead) throw new PermanentDomainEventError("LEAD_NOT_FOUND", "Agent lead is unavailable");
    await tx.lead.update({
      where: { id: lead.id },
      data: { ownerId: input.ownerId, lastActivityAt: new Date() }
    });
    const sourceId = `${input.executionId}:${input.node.id}:assign-owner`;
    if (!(await tx.activity.findFirst({ where: { sourceType: "AGENT_EXECUTION", sourceId } })))
      await tx.activity.create({
        data: {
          workspaceId: input.workspaceId,
          leadId: lead.id,
          entityType: "AGENT",
          entityId: input.executionId,
          actorType: "AGENT",
          sourceType: "AGENT_EXECUTION",
          sourceId,
          type: "NOTE_ADDED",
          title: "Lead owner assigned",
          description: input.node.label,
          metadata: { fromOwnerId: lead.ownerId, toOwnerId: input.ownerId },
          correlationId: input.correlationId,
          visibility: "BUSINESS"
        }
      });
  });
}

async function queueWorkflowCommunication(input: {
  workspaceId: string;
  lead: { id: string; contactId: string };
  executionId: string;
  correlationId: string;
  node: WorkflowNodeDto;
}): Promise<void> {
  const channel = configString(input.node, "channel");
  await assertCommunicationIntegrationEnabled(input.workspaceId, channel);
  const key = `workflow:${input.executionId}:node:${input.node.id}`;
  if (channel === "EMAIL") {
    const subject = configString(input.node, "subject") || "Following up on your request";
    const message = configString(input.node, "message");
    if (!message)
      throw new PermanentDomainEventError(
        "COMMUNICATION_MESSAGE_MISSING",
        "Email communication requires an approved message"
      );
    await workflowTransaction(async (tx) => {
      const conversation =
        (await tx.conversation.findFirst({
          where: { leadId: input.lead.id, channel: "EMAIL", status: "OPEN" },
          orderBy: { createdAt: "desc" }
        })) ??
        (await tx.conversation.create({
          data: { leadId: input.lead.id, channel: "EMAIL", mode: "AUTO", status: "OPEN" }
        }));
      const sequence = await tx.followUpSequence.upsert({
        where: { idempotencyKey: `${key}:email` },
        update: {},
        create: {
          workspaceId: input.workspaceId,
          leadId: input.lead.id,
          contactId: input.lead.contactId,
          conversationId: conversation.id,
          cadenceDays: [0],
          cadenceMode: "WORKFLOW",
          cadenceOffsetsMinutes: [0],
          idempotencyKey: `${key}:email`
        }
      });
      const attempt = await tx.followUpAttempt.upsert({
        where: { idempotencyKey: `${key}:email:attempt` },
        update: {},
        create: {
          sequenceId: sequence.id,
          leadId: input.lead.id,
          stepIndex: 0,
          kind: "FOLLOW_UP",
          scheduledAt: new Date(),
          subject,
          textBody: message,
          idempotencyKey: `${key}:email:attempt`
        }
      });
      const event = await tx.domainEventOutbox.upsert({
        where: { idempotencyKey: `${key}:email:dispatch` },
        update: {},
        create: {
          workspaceId: input.workspaceId,
          eventType: "FOLLOWUP_EMAIL_SEND_REQUESTED",
          aggregateType: "FollowUpAttempt",
          aggregateId: attempt.id,
          payload: {
            followUpSequenceId: sequence.id,
            followUpAttemptId: attempt.id,
            leadId: input.lead.id,
            conversationId: conversation.id,
            stepIndex: 0
          },
          correlationId: input.correlationId,
          idempotencyKey: `${key}:email:dispatch`
        }
      });
      await tx.followUpAttempt.update({
        where: { id: attempt.id },
        data: { domainEventId: event.id }
      });
    });
    return;
  }
  if (channel !== "WHATSAPP" && channel !== "VOICE")
    throw new PermanentDomainEventError(
      "COMMUNICATION_CHANNEL_INVALID",
      "Communication channel is not supported"
    );
  await workflowTransaction(async (tx) => {
    const sequence = await tx.callingSequence.upsert({
      where: { idempotencyKey: `${key}:${channel.toLowerCase()}` },
      update: {},
      create: {
        workspaceId: input.workspaceId,
        leadId: input.lead.id,
        contactId: input.lead.contactId,
        cadenceOffsets: [0],
        maxAttempts: 1,
        idempotencyKey: `${key}:${channel.toLowerCase()}`
      }
    });
    const attempt = await tx.callingAttempt.upsert({
      where: { idempotencyKey: `${key}:${channel.toLowerCase()}:attempt` },
      update: {},
      create: {
        sequenceId: sequence.id,
        leadId: input.lead.id,
        contactId: input.lead.contactId,
        attemptIndex: 0,
        scheduledAt: new Date(),
        idempotencyKey: `${key}:${channel.toLowerCase()}:attempt`
      }
    });
    const event = await tx.domainEventOutbox.upsert({
      where: { idempotencyKey: `${key}:${channel.toLowerCase()}:dispatch` },
      update: {},
      create: {
        workspaceId: input.workspaceId,
        eventType:
          channel === "WHATSAPP" ? "WHATSAPP_SEND_REQUESTED" : "CALL_AUTOMATION_ATTEMPT_DUE",
        aggregateType: "CallingAttempt",
        aggregateId: attempt.id,
        payload: {
          callingSequenceId: sequence.id,
          callingAttemptId: attempt.id,
          leadId: input.lead.id,
          contactId: input.lead.contactId,
          ...(channel === "WHATSAPP"
            ? { textBody: configString(input.node, "message") || null }
            : {})
        },
        correlationId: input.correlationId,
        idempotencyKey: `${key}:${channel.toLowerCase()}:dispatch`
      }
    });
    await tx.callingAttempt.update({
      where: { id: attempt.id },
      data: { domainEventId: event.id }
    });
  });
}

function createAgentRuntimeAdapters(input: {
  workspaceId: string;
  agentId: string;
  lead: { id: string; contactId: string; companyId: string; ownerId: string | null };
  correlationId: string;
}): AgentRuntimeAdapters {
  return {
    createTask: async ({ executionId, node, title }) =>
      createWorkflowTask({
        workspaceId: input.workspaceId,
        lead: input.lead,
        executionId,
        correlationId: input.correlationId,
        sourceType: "AGENT_EXECUTION",
        resumeOnCompletion: node.type === "HUMAN_HANDOFF",
        createdByAgentId: input.agentId,
        node: {
          id: node.id,
          type: "TASK",
          label: node.label,
          position: node.position,
          config: { ...node.config, title }
        }
      }),
    queueCommunication: async ({ executionId, node, channel, subject, message }) =>
      queueWorkflowCommunication({
        workspaceId: input.workspaceId,
        lead: input.lead,
        executionId,
        correlationId: input.correlationId,
        node: {
          id: node.id,
          type: "COMMUNICATION",
          label: node.label,
          position: node.position,
          config: { channel, subject, message }
        }
      }),
    updateLead: async ({ executionId, node, changes }) =>
      updateAgentLead({
        workspaceId: input.workspaceId,
        leadId: input.lead.id,
        executionId,
        correlationId: input.correlationId,
        node,
        changes
      }),
    assignOwner: async ({ executionId, node, ownerId }) =>
      assignAgentOwner({
        workspaceId: input.workspaceId,
        leadId: input.lead.id,
        executionId,
        correlationId: input.correlationId,
        node,
        ownerId
      })
  };
}

async function executeNode(input: {
  event: DomainEventOutbox;
  execution: NonNullable<Awaited<ReturnType<typeof loadExecution>>>;
  node: WorkflowNodeDto;
}): Promise<{
  branch?: string;
  waiting?: Date;
  externalResume?: boolean;
  human?: boolean;
  stopped?: boolean;
}> {
  const { execution, node } = input;
  const lead = execution.lead;
  if (!lead)
    throw new PermanentDomainEventError(
      "LEAD_CONTEXT_MISSING",
      "Workflow execution requires a lead"
    );
  const blocked = automationBlocked(lead);
  if (blocked && !["TRIGGER", "END"].includes(node.type))
    throw new PermanentDomainEventError(
      blocked,
      "Centralized lead ownership blocks workflow automation"
    );
  if (node.type === "CONDITION") {
    const field = configString(node, "field");
    const configuredValue = node.config.value;
    const expected =
      typeof configuredValue === "string" || typeof configuredValue === "number"
        ? String(configuredValue).toLowerCase()
        : "";
    const actual =
      field === "source"
        ? lead.source
        : field === "status"
          ? lead.status
          : field === "stageId"
            ? lead.stageId
            : field === "serviceInterest"
              ? (lead.serviceInterest ?? "")
              : field === "ownership"
                ? lead.automationOwnershipState
                : field === "meaningfulReply"
                  ? String(
                      executionContextBoolean(execution.input, "meaningfulReply") ||
                        executionContextValue(execution.input, "sourceEventType") ===
                          "CUSTOMER_REPLIED"
                    )
                  : field === "requiresHuman"
                    ? String(
                        executionContextBoolean(execution.input, "requiresHuman") ||
                          executionContextBoolean(execution.input, "requiresHumanReview")
                      )
                    : "";
    return { branch: actual.toLowerCase() === expected ? "true" : "false" };
  }
  if (node.type === "WAIT") {
    const cadenceIndex = node.config.cadenceIndex;
    const cadence = execution.version.policyConfig as WorkflowPolicyDto | null;
    const durationMinutes =
      typeof cadenceIndex === "number" && Number.isInteger(cadenceIndex)
        ? cadence?.cadenceMinutes?.[cadenceIndex]
        : node.config.durationMinutes;
    if (typeof durationMinutes !== "number" || durationMinutes < 1)
      throw new PermanentDomainEventError(
        "WORKFLOW_CADENCE_MISSING",
        "Wait node has no valid duration or policy cadence step"
      );
    return { waiting: new Date(Date.now() + durationMinutes * 60_000) };
  }
  if (node.type === "TASK")
    await createWorkflowTask({
      workspaceId: execution.workspaceId,
      lead,
      executionId: execution.id,
      correlationId: execution.correlationId,
      node
    });
  if (node.type === "COMMUNICATION")
    await queueWorkflowCommunication({
      workspaceId: execution.workspaceId,
      lead,
      executionId: execution.id,
      correlationId: execution.correlationId,
      node
    });
  if (node.type === "AGENT_INVOKE") {
    const agentId = configString(node, "agentId");
    if (!agentId)
      throw new PermanentDomainEventError(
        "AGENT_NOT_CONFIGURED",
        "Agent invocation has no configured agent"
      );
    const agentResult = await invokePublishedAgent({
      workspaceId: execution.workspaceId,
      agentId,
      leadId: lead.id,
      source: "WORKFLOW",
      sourceEntityType: "WorkflowStep",
      sourceEntityId: `${execution.id}:${node.id}`,
      correlationId: execution.correlationId,
      parentWorkflowExecutionId: execution.id,
      parentWorkflowNodeId: node.id,
      adapters: createAgentRuntimeAdapters({
        workspaceId: execution.workspaceId,
        agentId,
        lead,
        correlationId: execution.correlationId
      })
    });
    if (agentResult.outcome === "WAITING")
      return { waiting: agentResult.nextRunAt, externalResume: true };
    if (agentResult.outcome === "HUMAN_REQUIRED") return { human: true };
  }
  if (node.type === "INTEGRATION_ACTION") {
    const connectionId = configString(node, "connectionId");
    if (connectionId) {
      const connection = await workerPrisma.integrationAccount.findFirst({
        where: { id: connectionId, workspaceId: execution.workspaceId },
        select: { status: true }
      });
      if (!connection || connection.status === "DISABLED")
        throw new PermanentDomainEventError(
          "INTEGRATION_NOT_AVAILABLE",
          "Configured integration is unavailable in this workspace"
        );
    }
    const eventType = configString(node, "eventType");
    const allowed = new Set([
      "NOTIFICATION_ACKNOWLEDGED",
      "AGENT_CORRECTION_RECORDED",
      "REPLY_UNDERSTOOD"
    ]);
    if (!allowed.has(eventType))
      throw new PermanentDomainEventError(
        "UNSAFE_INTEGRATION_ACTION",
        "Integration action is not in the approved existing event registry"
      );
    await workerPrisma.domainEventOutbox.upsert({
      where: { idempotencyKey: `workflow:${execution.id}:${node.id}:integration` },
      update: {},
      create: {
        workspaceId: execution.workspaceId,
        eventType,
        aggregateType: "WorkflowExecution",
        aggregateId: execution.id,
        payload: { leadId: lead.id, workflowExecutionId: execution.id },
        correlationId: execution.correlationId,
        idempotencyKey: `workflow:${execution.id}:${node.id}:integration`
      }
    });
  }
  if (node.type === "CRM_ACTION") {
    const action = configString(node, "action");
    if (action === "STOP") {
      await recordOwnership({
        workspaceId: execution.workspaceId,
        leadId: lead.id,
        executionId: execution.id,
        correlationId: execution.correlationId,
        state: "AI_STOPPED",
        reason: "WORKFLOW_STOP"
      });
      return { stopped: true };
    }
    if (action === "ESCALATE" || action === "ASK_HUMAN") {
      await createWorkflowTask({
        workspaceId: execution.workspaceId,
        lead,
        executionId: execution.id,
        correlationId: execution.correlationId,
        resumeOnCompletion: true,
        node: {
          ...node,
          config: {
            ...node.config,
            title: configString(node, "title") || "Workflow needs human action",
            priority: "URGENT"
          }
        }
      });
      await recordOwnership({
        workspaceId: execution.workspaceId,
        leadId: lead.id,
        executionId: execution.id,
        correlationId: execution.correlationId,
        state: "HUMAN_REQUIRED",
        reason: `WORKFLOW_${action}`
      });
      return { human: true };
    }
    if (action === "FOLLOW_UP")
      await createWorkflowTask({
        workspaceId: execution.workspaceId,
        lead,
        executionId: execution.id,
        correlationId: execution.correlationId,
        node: {
          ...node,
          config: { ...node.config, title: configString(node, "title") || "Follow up with lead" }
        }
      });
  }
  if (node.type === "HUMAN_APPROVAL") {
    await createWorkflowTask({
      workspaceId: execution.workspaceId,
      lead,
      executionId: execution.id,
      correlationId: execution.correlationId,
      resumeOnCompletion: true,
      node: {
        ...node,
        config: {
          ...node.config,
          title: configString(node, "reason") || node.label,
          priority: "URGENT"
        }
      }
    });
    await recordOwnership({
      workspaceId: execution.workspaceId,
      leadId: lead.id,
      executionId: execution.id,
      correlationId: execution.correlationId,
      state: "HUMAN_REQUIRED",
      reason: "WORKFLOW_HUMAN_APPROVAL"
    });
    return { human: true };
  }
  return {};
}

async function loadExecution(id: string, workspaceId: string) {
  return workerPrisma.workflowExecution.findFirst({
    where: { id, workspaceId },
    include: {
      workflow: true,
      version: true,
      lead: { include: { contact: true, company: true } },
      steps: true
    }
  });
}
async function handleWorkflow(event: DomainEventOutbox): Promise<void> {
  if (!event.workspaceId)
    throw new PermanentDomainEventError(
      "WORKSPACE_CONTEXT_MISSING",
      "Workflow event has no workspace"
    );
  const executionId = payloadString(event, "workflowExecutionId");
  if (!executionId)
    throw new PermanentDomainEventError("EXECUTION_ID_MISSING", "Workflow execution id is missing");
  let execution = await loadExecution(executionId, event.workspaceId);
  if (!execution)
    throw new PermanentDomainEventError(
      "EXECUTION_NOT_FOUND",
      "Workflow execution was not found in this workspace"
    );
  if (["SUCCEEDED", "CANCELED"].includes(execution.status)) return;
  if (
    execution.workflow.status !== "PUBLISHED" ||
    execution.workflow.currentVersionId !== execution.versionId
  ) {
    await workerPrisma.workflowExecution.update({
      where: { id: execution.id },
      data: { status: "CANCELED", completedAt: new Date(), failureCode: "WORKFLOW_NOT_ACTIVE" }
    });
    return;
  }
  if (
    !execution.lead ||
    !matchesPolicy(
      execution.version.policyConfig as WorkflowPolicyDto | null,
      execution.lead,
      (execution.input as Prisma.JsonObject | null) ?? {}
    )
  ) {
    await workerPrisma.workflowExecution.update({
      where: { id: execution.id },
      data: { status: "CANCELED", completedAt: new Date(), failureCode: "POLICY_NOT_MATCHED" }
    });
    return;
  }
  const blocked = automationBlocked(execution.lead);
  if (blocked) {
    await workerPrisma.workflowExecution.update({
      where: { id: execution.id },
      data: {
        status: blocked.startsWith("OWNERSHIP_HUMAN") ? "HUMAN_REQUIRED" : "CANCELED",
        completedAt: blocked.startsWith("OWNERSHIP_HUMAN") ? null : new Date(),
        failureCode: blocked
      }
    });
    return;
  }
  const lead = execution.lead;
  const definition = execution.version.definition as unknown as WorkflowDefinitionDto;
  const nodes = new Map(definition.nodes.map((node) => [node.id, node]));
  let node = execution.currentNodeId
    ? nodes.get(execution.currentNodeId)
    : definition.nodes.find((item) => item.type === "TRIGGER");
  if (!node)
    throw new PermanentDomainEventError(
      "WORKFLOW_DEFINITION_INVALID",
      "Workflow has no executable trigger"
    );
  await workerPrisma.workflowExecution.update({
    where: { id: execution.id },
    data: {
      status: "RUNNING",
      startedAt: execution.startedAt ?? new Date(),
      attempts: { increment: 1 }
    }
  });
  for (;;) {
    const stepKey = `workflow:${execution.id}:node:${node.id}`;
    const existing = await workerPrisma.workflowStepExecution.findUnique({
      where: { idempotencyKey: stepKey }
    });
    if (existing?.status === "WAITING" && node.type !== "AGENT_INVOKE")
      await workerPrisma.workflowStepExecution.update({
        where: { id: existing.id },
        data: { status: "SUCCEEDED", completedAt: new Date(), nextAttemptAt: null }
      });
    let result: Awaited<ReturnType<typeof executeNode>> = {};
    if (
      !existing ||
      existing.status === "FAILED" ||
      (existing.status === "WAITING" && node.type === "AGENT_INVOKE")
    ) {
      const step = existing
        ? await workerPrisma.workflowStepExecution.update({
            where: { id: existing.id },
            data: {
              status: "RUNNING",
              attempt: { increment: 1 },
              startedAt: new Date(),
              failureCode: null,
              failureMessage: null
            }
          })
        : await workerPrisma.workflowStepExecution.create({
            data: {
              workflowExecutionId: execution.id,
              nodeId: node.id,
              nodeType: node.type,
              status: "RUNNING",
              idempotencyKey: stepKey,
              input: node.config,
              startedAt: new Date()
            }
          });
      try {
        result = await executeNode({ event, execution, node });
      } catch (error) {
        await workerPrisma.workflowStepExecution.update({
          where: { id: step.id },
          data: {
            status: "FAILED",
            completedAt: new Date(),
            failureCode:
              error instanceof PermanentDomainEventError ? error.code : "STEP_EXECUTION_FAILED",
            failureMessage: error instanceof Error ? error.message : "Workflow step failed"
          }
        });
        await workerPrisma.workflowExecution.update({
          where: { id: execution.id },
          data: {
            status: "FAILED",
            failureCode: "STEP_EXECUTION_FAILED",
            failureMessage: error instanceof Error ? error.message : "Workflow step failed"
          }
        });
        void emitOperationalAlert({
          category: "workflow_failure",
          severity: "error",
          message: error instanceof Error ? error.message : "Workflow step failed",
          correlationId: event.correlationId,
          executionId: execution.id,
          metadata: { nodeId: node.id, nodeType: node.type }
        });
        throw error;
      }
      if (result.waiting) {
        const writes: Prisma.PrismaPromise<unknown>[] = [
          workerPrisma.workflowStepExecution.update({
            where: { id: step.id },
            data: { status: "WAITING", nextAttemptAt: result.waiting }
          }),
          workerPrisma.workflowExecution.update({
            where: { id: execution.id },
            data: { status: "WAITING", currentNodeId: node.id, nextRunAt: result.waiting }
          })
        ];
        if (!result.externalResume)
          writes.push(
            workerPrisma.domainEventOutbox.upsert({
              where: { idempotencyKey: `${stepKey}:resume` },
              update: {},
              create: {
                workspaceId: execution.workspaceId,
                eventType: "WORKFLOW_EXECUTION_RESUME",
                aggregateType: "WorkflowExecution",
                aggregateId: execution.id,
                payload: { workflowExecutionId: execution.id, leadId: execution.leadId },
                correlationId: execution.correlationId,
                idempotencyKey: `${stepKey}:resume`,
                nextAttemptAt: result.waiting
              }
            })
          );
        await workerPrisma.$transaction(writes);
        return;
      }
      await workerPrisma.workflowStepExecution.update({
        where: { id: step.id },
        data: {
          status: "SUCCEEDED",
          output: result,
          completedAt: new Date()
        }
      });
      if (result.human || result.stopped) {
        await workerPrisma.workflowExecution.update({
          where: { id: execution.id },
          data: {
            status: result.human ? "HUMAN_REQUIRED" : "CANCELED",
            currentNodeId: node.id,
            completedAt: result.stopped ? new Date() : null
          }
        });
        return;
      }
    }
    if (node.type === "END") {
      await workerPrisma.workflowExecution.update({
        where: { id: execution.id },
        data: {
          status: "SUCCEEDED",
          currentNodeId: node.id,
          completedAt: new Date(),
          result: { outcome: configString(node, "outcome") || "COMPLETED" },
          failureCode: null,
          failureMessage: null
        }
      });
      await workerPrisma.activity.create({
        data: {
          workspaceId: execution.workspaceId,
          leadId: lead.id,
          entityType: "WORKFLOW",
          entityId: execution.id,
          actorType: "WORKFLOW",
          sourceType: "WORKFLOW_EXECUTION",
          sourceId: execution.id,
          type: "TASK_UPDATED",
          title: "Workflow completed",
          description: execution.workflow.name,
          metadata: { workflowId: execution.workflowId, executionId: execution.id },
          correlationId: execution.correlationId,
          visibility: "BUSINESS"
        }
      });
      return;
    }
    const edge = nextEdge(definition.edges, node.id, result.branch);
    if (!edge)
      throw new PermanentDomainEventError(
        "WORKFLOW_PATH_ENDED",
        `No valid connection leaves ${node.label}`
      );
    node = nodes.get(edge.target);
    if (!node)
      throw new PermanentDomainEventError(
        "WORKFLOW_NODE_MISSING",
        "Connected workflow node is missing"
      );
    await workerPrisma.workflowExecution.update({
      where: { id: execution.id },
      data: { currentNodeId: node.id }
    });
    execution = (await loadExecution(execution.id, execution.workspaceId)) ?? execution;
  }
}

async function handleAgentResume(event: DomainEventOutbox): Promise<void> {
  if (!event.workspaceId)
    throw new PermanentDomainEventError(
      "WORKSPACE_CONTEXT_MISSING",
      "Agent resume event has no workspace"
    );
  const executionId = payloadString(event, "agentExecutionId");
  if (!executionId)
    throw new PermanentDomainEventError(
      "AGENT_EXECUTION_ID_MISSING",
      "Agent resume event has no execution id"
    );
  const execution = await workerPrisma.agentExecution.findFirst({
    where: { id: executionId, workspaceId: event.workspaceId }
  });
  if (!execution)
    throw new PermanentDomainEventError(
      "AGENT_EXECUTION_NOT_FOUND",
      "Agent execution is unavailable in this workspace"
    );
  if (["SUCCEEDED", "FAILED", "CANCELED", "HUMAN_REQUIRED"].includes(execution.status)) return;
  if (!execution.leadId || !execution.sourceEntityType || !execution.sourceEntityId)
    throw new PermanentDomainEventError(
      "AGENT_EXECUTION_CONTEXT_MISSING",
      "Agent execution has incomplete resume context"
    );
  const lead = await workerPrisma.lead.findFirst({
    where: { id: execution.leadId, workspaceId: event.workspaceId },
    include: { contact: true, company: true }
  });
  if (!lead) throw new PermanentDomainEventError("LEAD_NOT_FOUND", "Agent lead is unavailable");
  await invokePublishedAgent({
    workspaceId: event.workspaceId,
    agentId: execution.agentId,
    leadId: lead.id,
    source: execution.source,
    sourceEntityType: execution.sourceEntityType,
    sourceEntityId: execution.sourceEntityId,
    correlationId: execution.correlationId,
    adapters: createAgentRuntimeAdapters({
      workspaceId: event.workspaceId,
      agentId: execution.agentId,
      lead,
      correlationId: execution.correlationId
    })
  });
}

export const workflowDomainEventHandlers: DomainEventHandlerMap = {
  WORKFLOW_EXECUTION_REQUESTED: { handle: handleWorkflow },
  WORKFLOW_EXECUTION_RESUME: { handle: handleWorkflow },
  AGENT_EXECUTION_RESUME: { handle: handleAgentResume }
};

export async function triggerWorkflowsForDomainEvent(event: DomainEventOutbox): Promise<void> {
  if (!event.workspaceId || event.eventType.startsWith("WORKFLOW_")) return;
  const leadId = payloadString(event, "leadId");
  if (!leadId) return;
  const lead = await workerPrisma.lead.findFirst({
    where: { id: leadId, workspaceId: event.workspaceId },
    include: { contact: true, company: true }
  });
  if (!lead || automationBlocked(lead)) return;
  const workflows = await workerPrisma.workflow.findMany({
    where: { workspaceId: event.workspaceId, status: "PUBLISHED", currentVersionId: { not: null } },
    include: { currentVersion: true }
  });
  for (const workflow of workflows) {
    const version = workflow.currentVersion;
    if (
      !version ||
      !matchesPolicy(
        version.policyConfig as WorkflowPolicyDto | null,
        lead,
        event.payload as Prisma.JsonObject
      )
    )
      continue;
    const definition = version.definition as unknown as WorkflowDefinitionDto;
    const trigger = definition.nodes.find((node) => node.type === "TRIGGER");
    const triggerEvent = trigger ? configString(trigger, "event") : "";
    if (triggerEvent !== "*" && triggerEvent !== event.eventType) continue;
    const idempotencyKey = `workflow:${workflow.id}:event:${event.id}`;
    await workflowTransaction(async (tx) => {
      const execution = await tx.workflowExecution.upsert({
        where: { idempotencyKey },
        update: {},
        create: {
          workspaceId: event.workspaceId ?? "",
          workflowId: workflow.id,
          versionId: version.id,
          leadId,
          source: "DOMAIN_EVENT",
          sourceEntityType: event.aggregateType,
          sourceEntityId: event.aggregateId,
          idempotencyKey,
          correlationId: event.correlationId,
          input: {
            sourceEventId: event.id,
            sourceEventType: event.eventType,
            policyContext: event.payload as Prisma.InputJsonObject
          }
        }
      });
      await tx.domainEventOutbox.upsert({
        where: { idempotencyKey: `${idempotencyKey}:dispatch` },
        update: {},
        create: {
          workspaceId: event.workspaceId,
          eventType: "WORKFLOW_EXECUTION_REQUESTED",
          aggregateType: "WorkflowExecution",
          aggregateId: execution.id,
          payload: { workflowExecutionId: execution.id, leadId },
          correlationId: event.correlationId,
          idempotencyKey: `${idempotencyKey}:dispatch`
        }
      });
    });
  }
}
