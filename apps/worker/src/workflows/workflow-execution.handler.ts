import { Prisma, type DomainEventOutbox } from "@prisma/client";
import { emitOperationalAlert } from "@shilabs/shared-config";
import type {
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

function payloadString(event: DomainEventOutbox, key: string): string | null {
  const value = (event.payload as Prisma.JsonObject)[key];
  return typeof value === "string" && value.trim() ? value : null;
}
function configString(node: WorkflowNodeDto, key: string): string {
  const value = node.config[key];
  return typeof value === "string" ? value.trim() : "";
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
  await workerPrisma.$transaction(async (tx) => {
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
}): Promise<void> {
  const title = configString(input.node, "title") || input.node.label;
  const dueMinutes =
    typeof input.node.config.dueMinutes === "number" ? input.node.config.dueMinutes : 60;
  const projectionKey = `workflow:${input.executionId}:node:${input.node.id}`;
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
      createdByType: "WORKFLOW",
      sourceType: "WORKFLOW_EXECUTION",
      sourceId: input.executionId,
      projectionKey,
      metadata: { nodeId: input.node.id },
      correlationId: input.correlationId
    }
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
    await workerPrisma.$transaction(async (tx) => {
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
  await workerPrisma.$transaction(async (tx) => {
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
          contactId: input.lead.contactId
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

async function executeNode(input: {
  event: DomainEventOutbox;
  execution: NonNullable<Awaited<ReturnType<typeof loadExecution>>>;
  node: WorkflowNodeDto;
}): Promise<{ branch?: string; waiting?: Date; human?: boolean; stopped?: boolean }> {
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
    const agent = await workerPrisma.agent.findFirst({
      where: {
        id: configString(node, "agentId"),
        workspaceId: execution.workspaceId,
        status: "ACTIVE"
      },
      include: { currentVersion: true }
    });
    if (!agent?.currentVersion)
      throw new PermanentDomainEventError(
        "AGENT_NOT_AVAILABLE",
        "Configured agent is not active in this workspace"
      );
    await workerPrisma.agentExecution.upsert({
      where: {
        workspaceId_agentId_sourceEntityType_sourceEntityId: {
          workspaceId: execution.workspaceId,
          agentId: agent.id,
          sourceEntityType: "WorkflowStep",
          sourceEntityId: `${execution.id}:${node.id}`
        }
      },
      update: {},
      create: {
        workspaceId: execution.workspaceId,
        agentId: agent.id,
        versionId: agent.currentVersion.id,
        source: "WORKFLOW",
        sourceEntityType: "WorkflowStep",
        sourceEntityId: `${execution.id}:${node.id}`,
        entityType: "Lead",
        entityId: lead.id,
        leadId: lead.id,
        status: "SUCCEEDED",
        startedAt: new Date(),
        completedAt: new Date(),
        durationMs: 0,
        summary: `Invoked by workflow: ${node.label}`,
        result: { workflowExecutionId: execution.id, nodeId: node.id },
        correlationId: execution.correlationId
      }
    });
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
    if (existing?.status === "WAITING")
      await workerPrisma.workflowStepExecution.update({
        where: { id: existing.id },
        data: { status: "SUCCEEDED", completedAt: new Date(), nextAttemptAt: null }
      });
    let result: Awaited<ReturnType<typeof executeNode>> = {};
    if (!existing || existing.status === "FAILED") {
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
        await workerPrisma.$transaction([
          workerPrisma.workflowStepExecution.update({
            where: { id: step.id },
            data: { status: "WAITING", nextAttemptAt: result.waiting }
          }),
          workerPrisma.workflowExecution.update({
            where: { id: execution.id },
            data: { status: "WAITING", currentNodeId: node.id, nextRunAt: result.waiting }
          }),
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
        ]);
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

export const workflowDomainEventHandlers: DomainEventHandlerMap = {
  WORKFLOW_EXECUTION_REQUESTED: { handle: handleWorkflow },
  WORKFLOW_EXECUTION_RESUME: { handle: handleWorkflow }
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
    await workerPrisma.$transaction(async (tx) => {
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
