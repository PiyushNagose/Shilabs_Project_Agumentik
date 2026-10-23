import { randomUUID } from "node:crypto";
import {
  Prisma,
  type WorkflowExecution,
  type WorkflowStepExecution,
  type WorkflowVersion
} from "@prisma/client";
import type {
  WorkflowDashboardDto,
  WorkflowDefinitionDto,
  WorkflowDetailDto,
  WorkflowDto,
  WorkflowExecutionDto,
  WorkflowPolicyDto,
  WorkflowPreviewDto,
  WorkflowValidationDto,
  WorkflowVersionDto
} from "@shilabs/shared-types";
import { AppError } from "../../shared/errors.js";
import { prisma } from "../../shared/prisma.js";
import type { AuthenticatedUser } from "../auth/auth.types.js";
import { isWorkspaceManager } from "../authorization/workspace-permissions.js";
import { publishDomainEvent } from "../domain-events/domain-events.service.js";
import { publishRealtimeEvent } from "../realtime/realtime.service.js";
import type {
  CreateWorkflowInput,
  ExecuteWorkflowInput,
  PreviewWorkflowInput,
  SaveWorkflowDraftInput,
  UpdateWorkflowInput,
  UpdateWorkflowStatusInput,
  WorkflowDefinitionInput
} from "./workflow.schemas.js";
import {
  previewWorkflowDefinition,
  validateWorkflowDefinition
} from "./workflow-validation.service.js";

const include = {
  currentVersion: true,
  draftVersion: true,
  versions: { orderBy: { version: "desc" as const } }
};
type WorkflowRecord = Prisma.WorkflowGetPayload<{ include: typeof include }>;

function workspaceIdFor(actor: AuthenticatedUser): string {
  if (!actor.activeWorkspaceId)
    throw new AppError(403, "AUTHORIZATION_ERROR", "Active workspace required");
  return actor.activeWorkspaceId;
}
export function assertCanManageWorkflows(actor: AuthenticatedUser): void {
  if (!isWorkspaceManager(actor))
    throw new AppError(403, "AUTHORIZATION_ERROR", "Workflow management requires manager access");
}
function keyFor(name: string): string {
  return `${name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")}-${randomUUID().slice(0, 8)}`;
}
function definition(value: Prisma.JsonValue): WorkflowDefinitionDto {
  return value as unknown as WorkflowDefinitionDto;
}
function policy(value: Prisma.JsonValue | null): WorkflowPolicyDto | null {
  return value as unknown as WorkflowPolicyDto | null;
}
function versionDto(value: WorkflowVersion): WorkflowVersionDto {
  return {
    id: value.id,
    workflowId: value.workflowId,
    version: value.version,
    definition: definition(value.definition),
    policyConfig: policy(value.policyConfig),
    publishedAt: value.publishedAt?.toISOString() ?? null,
    publishedByUserId: value.publishedByUserId,
    createdAt: value.createdAt.toISOString()
  };
}
function executionDto(
  value: WorkflowExecution & { steps: WorkflowStepExecution[] }
): WorkflowExecutionDto {
  return {
    id: value.id,
    workflowId: value.workflowId,
    versionId: value.versionId,
    leadId: value.leadId,
    source: value.source,
    status: value.status,
    currentNodeId: value.currentNodeId,
    nextRunAt: ["QUEUED", "WAITING"].includes(value.status) ? value.nextRunAt.toISOString() : null,
    correlationId: value.correlationId,
    failureCode: value.failureCode,
    failureMessage: value.failureMessage,
    startedAt: value.startedAt?.toISOString() ?? null,
    completedAt: value.completedAt?.toISOString() ?? null,
    createdAt: value.createdAt.toISOString(),
    steps: value.steps.map((step) => ({
      id: step.id,
      nodeId: step.nodeId,
      nodeType: step.nodeType,
      status: step.status,
      attempt: step.attempt,
      failureCode: step.failureCode,
      failureMessage: step.failureMessage,
      startedAt: step.startedAt?.toISOString() ?? null,
      completedAt: step.completedAt?.toISOString() ?? null,
      nextAttemptAt: step.nextAttemptAt?.toISOString() ?? null
    }))
  };
}
function workflowDto(
  value: WorkflowRecord,
  executions: (WorkflowExecution & { steps: WorkflowStepExecution[] })[]
): WorkflowDto {
  const own = executions.filter((item) => item.workflowId === value.id);
  return {
    id: value.id,
    key: value.key,
    name: value.name,
    description: value.description,
    status: value.status,
    currentVersionId: value.currentVersionId,
    draftVersionId: value.draftVersionId,
    createdByUserId: value.createdByUserId,
    createdAt: value.createdAt.toISOString(),
    updatedAt: value.updatedAt.toISOString(),
    currentVersion: value.currentVersion ? versionDto(value.currentVersion) : null,
    draftVersion: value.draftVersion ? versionDto(value.draftVersion) : null,
    versions: value.versions.map(versionDto),
    executionCount: own.length,
    runningCount: own.filter((item) =>
      ["QUEUED", "RUNNING", "WAITING", "HUMAN_REQUIRED"].includes(item.status)
    ).length,
    lastExecutedAt:
      own
        .map((item) => item.startedAt?.toISOString())
        .filter((value): value is string => Boolean(value))
        .sort()
        .at(-1) ?? null
  };
}
async function scoped(actor: AuthenticatedUser, id: string): Promise<WorkflowRecord> {
  const value = await prisma.workflow.findFirst({
    where: { id, workspaceId: workspaceIdFor(actor) },
    include
  });
  if (!value) throw new AppError(404, "NOT_FOUND", "Workflow not found");
  return value;
}
async function audit(
  actor: AuthenticatedUser,
  workflowId: string,
  action: string,
  after: Prisma.InputJsonObject
): Promise<void> {
  await prisma.auditEvent.create({
    data: {
      workspaceId: workspaceIdFor(actor),
      actorType: "USER",
      actorId: actor.id,
      actorUserId: actor.id,
      sourceType: "WORKFLOW_BUILDER",
      sourceId: workflowId,
      entityType: "Workflow",
      entityId: workflowId,
      action,
      after
    }
  });
}

export async function listWorkflows(actor: AuthenticatedUser): Promise<WorkflowDashboardDto> {
  const workspaceId = workspaceIdFor(actor);
  const [workflows, executions] = await Promise.all([
    prisma.workflow.findMany({ where: { workspaceId }, include, orderBy: { updatedAt: "desc" } }),
    prisma.workflowExecution.findMany({
      where: { workspaceId },
      include: { steps: { orderBy: { createdAt: "asc" } } },
      orderBy: { createdAt: "desc" },
      take: 500
    })
  ]);
  return {
    workflows: workflows.map((item) => workflowDto(item, executions)),
    summary: {
      total: workflows.length,
      published: workflows.filter((item) => item.status === "PUBLISHED").length,
      paused: workflows.filter((item) => item.status === "PAUSED").length,
      executions: executions.length,
      running: executions.filter((item) =>
        ["QUEUED", "RUNNING", "WAITING", "HUMAN_REQUIRED"].includes(item.status)
      ).length
    }
  };
}
export async function getWorkflow(
  actor: AuthenticatedUser,
  id: string
): Promise<WorkflowDetailDto> {
  const value = await scoped(actor, id);
  const executions = await prisma.workflowExecution.findMany({
    where: { workspaceId: workspaceIdFor(actor), workflowId: id },
    include: { steps: { orderBy: { createdAt: "asc" } } },
    orderBy: { createdAt: "desc" },
    take: 100
  });
  return { ...workflowDto(value, executions), executions: executions.map(executionDto) };
}

const defaultDefinition: WorkflowDefinitionInput = {
  schemaVersion: 1,
  kind: "WORKFLOW",
  nodes: [
    {
      id: "trigger",
      type: "TRIGGER",
      label: "Lead event",
      position: { x: 300, y: 60 },
      config: { event: "LEAD_UPDATED" }
    },
    {
      id: "end",
      type: "END",
      label: "Complete",
      position: { x: 300, y: 240 },
      config: { outcome: "COMPLETED" }
    }
  ],
  edges: [{ id: "trigger-end", source: "trigger", target: "end", branch: null }]
};
export async function createWorkflow(
  actor: AuthenticatedUser,
  input: CreateWorkflowInput
): Promise<WorkflowDetailDto> {
  assertCanManageWorkflows(actor);
  const workspaceId = workspaceIdFor(actor);
  const created = await prisma.$transaction(async (tx) => {
    const workflow = await tx.workflow.create({
      data: {
        workspaceId,
        key: keyFor(input.name),
        name: input.name,
        description: input.description,
        createdByUserId: actor.id
      }
    });
    const version = await tx.workflowVersion.create({
      data: {
        workflowId: workflow.id,
        version: 1,
        definition: (input.definition ?? defaultDefinition) as Prisma.InputJsonObject,
        policyConfig: input.policyConfig
      }
    });
    return tx.workflow.update({
      where: { id: workflow.id },
      data: { draftVersionId: version.id },
      include
    });
  });
  await audit(actor, created.id, "WORKFLOW_CREATED", { name: created.name });
  await publishRealtimeEvent({ workspaceId, entityType: "workflow", action: "workflow-created" });
  return { ...workflowDto(created, []), executions: [] };
}
export async function updateWorkflow(
  actor: AuthenticatedUser,
  id: string,
  input: UpdateWorkflowInput
): Promise<WorkflowDetailDto> {
  assertCanManageWorkflows(actor);
  const existing = await scoped(actor, id);
  if (existing.status === "ARCHIVED")
    throw new AppError(409, "CONFLICT", "Archived workflows cannot be edited");
  await prisma.workflow.update({ where: { id }, data: input });
  await audit(actor, id, "WORKFLOW_UPDATED", input);
  await publishRealtimeEvent({
    workspaceId: workspaceIdFor(actor),
    entityType: "workflow",
    action: "workflow-updated"
  });
  return getWorkflow(actor, id);
}
export async function saveWorkflowDraft(
  actor: AuthenticatedUser,
  id: string,
  input: SaveWorkflowDraftInput
): Promise<WorkflowDetailDto> {
  assertCanManageWorkflows(actor);
  const existing = await scoped(actor, id);
  if (existing.status === "ARCHIVED")
    throw new AppError(409, "CONFLICT", "Archived workflows cannot be edited");
  const created = await prisma.$transaction(async (tx) => {
    const version = await tx.workflowVersion.create({
      data: {
        workflowId: id,
        version: (existing.versions[0]?.version ?? 0) + 1,
        definition: input.definition as Prisma.InputJsonObject,
        policyConfig: input.policyConfig
      }
    });
    await tx.workflow.update({ where: { id }, data: { draftVersionId: version.id } });
    return version;
  });
  await audit(actor, id, "WORKFLOW_DRAFT_SAVED", {
    version: created.version,
    nodeCount: input.definition.nodes.length
  });
  await publishRealtimeEvent({
    workspaceId: workspaceIdFor(actor),
    entityType: "workflow",
    action: "workflow-draft-saved"
  });
  return getWorkflow(actor, id);
}
function persisted(value: Prisma.JsonValue | undefined): WorkflowDefinitionInput {
  if (!value || typeof value !== "object" || Array.isArray(value) || value.kind !== "WORKFLOW")
    throw new AppError(409, "CONFLICT", "Save a workflow draft before continuing");
  return value as unknown as WorkflowDefinitionInput;
}
export async function validateWorkflow(
  actor: AuthenticatedUser,
  id: string
): Promise<WorkflowValidationDto> {
  const value = await scoped(actor, id);
  return validateWorkflowDefinition(
    persisted((value.draftVersion ?? value.currentVersion)?.definition)
  );
}
export async function previewWorkflow(
  actor: AuthenticatedUser,
  id: string,
  input: PreviewWorkflowInput
): Promise<WorkflowPreviewDto> {
  const value = await scoped(actor, id);
  return previewWorkflowDefinition(
    input.definition ?? persisted((value.draftVersion ?? value.currentVersion)?.definition)
  );
}
export async function publishWorkflow(
  actor: AuthenticatedUser,
  id: string
): Promise<WorkflowDetailDto> {
  assertCanManageWorkflows(actor);
  const value = await scoped(actor, id);
  if (value.status === "ARCHIVED")
    throw new AppError(409, "CONFLICT", "Archived workflows cannot be published");
  const draft = value.draftVersion;
  if (!draft) throw new AppError(409, "CONFLICT", "No unpublished workflow draft exists");
  const validation = validateWorkflowDefinition(persisted(draft.definition));
  if (!validation.valid)
    throw new AppError(
      422,
      "VALIDATION_ERROR",
      validation.issues[0]?.message ?? "Workflow validation failed",
      { issues: validation.issues }
    );
  await prisma.$transaction([
    prisma.workflowVersion.update({
      where: { id: draft.id },
      data: { publishedAt: new Date(), publishedByUserId: actor.id }
    }),
    prisma.workflow.update({
      where: { id },
      data: { status: "PUBLISHED", currentVersionId: draft.id, draftVersionId: null }
    })
  ]);
  await audit(actor, id, "WORKFLOW_PUBLISHED", { version: draft.version });
  await publishRealtimeEvent({
    workspaceId: workspaceIdFor(actor),
    entityType: "workflow",
    action: "workflow-published"
  });
  return getWorkflow(actor, id);
}
export async function updateWorkflowStatus(
  actor: AuthenticatedUser,
  id: string,
  input: UpdateWorkflowStatusInput
): Promise<WorkflowDetailDto> {
  assertCanManageWorkflows(actor);
  const value = await scoped(actor, id);
  if (value.status === "ARCHIVED")
    throw new AppError(409, "CONFLICT", "Archived workflows cannot be resumed");
  if (input.status === "PUBLISHED" && !value.currentVersionId)
    throw new AppError(409, "CONFLICT", "Publish a valid version first");
  await prisma.workflow.update({ where: { id }, data: { status: input.status } });
  if (input.status === "PAUSED" || input.status === "ARCHIVED")
    await prisma.workflowExecution.updateMany({
      where: {
        workflowId: id,
        workspaceId: workspaceIdFor(actor),
        status: { in: ["QUEUED", "RUNNING", "WAITING"] }
      },
      data: { status: "CANCELED", completedAt: new Date(), failureCode: `WORKFLOW_${input.status}` }
    });
  await audit(actor, id, `WORKFLOW_${input.status}`, { status: input.status });
  await publishRealtimeEvent({
    workspaceId: workspaceIdFor(actor),
    entityType: "workflow",
    action: `workflow-${input.status.toLowerCase()}`
  });
  return getWorkflow(actor, id);
}
export async function executeWorkflow(
  actor: AuthenticatedUser,
  id: string,
  input: ExecuteWorkflowInput
): Promise<WorkflowExecutionDto> {
  assertCanManageWorkflows(actor);
  const workflow = await scoped(actor, id);
  if (workflow.status !== "PUBLISHED" || !workflow.currentVersionId)
    throw new AppError(409, "CONFLICT", "Only published workflows can execute");
  const workspaceId = workspaceIdFor(actor);
  const lead = await prisma.lead.findFirst({
    where: { id: input.leadId, workspaceId },
    include: { contact: { select: { doNotContact: true } } }
  });
  if (!lead) throw new AppError(404, "NOT_FOUND", "Lead not found");
  if (
    lead.contact.doNotContact ||
    ["WON", "LOST", "DISQUALIFIED"].includes(lead.status) ||
    lead.automationOwnershipState !== "AI_ACTIVE"
  )
    throw new AppError(
      409,
      "CONFLICT",
      "Lead ownership or terminal state blocks workflow execution"
    );
  const correlationId = randomUUID();
  const idempotencyKey = input.idempotencyKey ?? `workflow:${id}:${input.leadId}:${correlationId}`;
  const execution = await prisma.workflowExecution.upsert({
    where: { idempotencyKey },
    update: {},
    create: {
      workspaceId,
      workflowId: id,
      versionId: workflow.currentVersionId,
      leadId: lead.id,
      source: input.source,
      sourceEntityType: input.sourceEntityType,
      sourceEntityId: input.sourceEntityId,
      idempotencyKey,
      correlationId,
      input: input.input as Prisma.InputJsonObject | undefined
    },
    include: { steps: true }
  });
  await publishDomainEvent({
    eventType: "WORKFLOW_EXECUTION_REQUESTED",
    aggregateType: "WorkflowExecution",
    aggregateId: execution.id,
    payload: { workflowExecutionId: execution.id, leadId: lead.id },
    correlationId,
    idempotencyKey: `${idempotencyKey}:dispatch`,
    maxAttempts: execution.maxAttempts
  });
  await audit(actor, id, "WORKFLOW_EXECUTION_REQUESTED", {
    executionId: execution.id,
    leadId: lead.id,
    correlationId
  });
  await publishRealtimeEvent({
    workspaceId,
    entityType: "workflow",
    action: "workflow-execution-requested",
    leadId: lead.id
  });
  return executionDto(execution);
}
