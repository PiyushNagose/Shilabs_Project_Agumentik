import { randomUUID } from "node:crypto";
import type { Prisma, Task, TaskCreatorType } from "@prisma/client";
import type { TaskDto } from "@shilabs/shared-types";
import { AppError } from "../../shared/errors.js";
import { prisma } from "../../shared/prisma.js";
import { toPublicUser } from "../auth/auth.service.js";
import type { AuthenticatedUser } from "../auth/auth.types.js";
import {
  assertCanAccessLead,
  assertCanMutateLead,
  leadVisibilityWhere
} from "../leads/lead.permissions.js";
import { publishRealtimeEvent } from "../realtime/realtime.service.js";
import type { CreateTaskInput, ListTasksQuery, UpdateTaskInput } from "./task.schemas.js";

const taskInclude = { assignedToUser: true } satisfies Prisma.TaskInclude;
type TaskRecord = Prisma.TaskGetPayload<{ include: typeof taskInclude }>;

function requireWorkspace(actor: AuthenticatedUser): string {
  if (!actor.activeWorkspaceId)
    throw new AppError(403, "AUTHORIZATION_ERROR", "Workspace required");
  return actor.activeWorkspaceId;
}

function toTaskDto(task: TaskRecord): TaskDto {
  return {
    ...task,
    dueAt: task.dueAt?.toISOString() ?? null,
    reminderAt: task.reminderAt?.toISOString() ?? null,
    completedAt: task.completedAt?.toISOString() ?? null,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
    metadata: task.metadata,
    assignedToUser: task.assignedToUser ? toPublicUser(task.assignedToUser) : null
  };
}

async function loadAuthorizedLead(actor: AuthenticatedUser, leadId: string, mutate: boolean) {
  const lead = await prisma.lead.findUnique({ where: { id: leadId } });
  if (!lead) throw new AppError(404, "NOT_FOUND", "Lead not found");
  if (mutate) assertCanMutateLead(actor, lead);
  else assertCanAccessLead(actor, lead);
  return lead;
}

async function assertWorkspaceAssignee(
  workspaceId: string,
  userId: string | null | undefined
): Promise<void> {
  if (!userId) return;
  const member = await prisma.workspaceMember.findFirst({
    where: { workspaceId, userId, status: "ACTIVE" },
    select: { id: true }
  });
  if (!member)
    throw new AppError(400, "VALIDATION_ERROR", "Assignee is not an active workspace member");
}

function activityData(input: {
  task: Task;
  type: "TASK_CREATED" | "TASK_UPDATED" | "TASK_COMPLETED";
  actorType: TaskCreatorType;
  actorUserId?: string | null;
  correlationId: string;
}): Prisma.ActivityUncheckedCreateInput {
  if (!input.task.leadId)
    throw new AppError(400, "VALIDATION_ERROR", "Timeline tasks require a lead");
  return {
    workspaceId: input.task.workspaceId,
    leadId: input.task.leadId,
    entityType: "TASK",
    entityId: input.task.id,
    actorType: input.actorType,
    actorUserId: input.actorUserId,
    actorAgentId: input.task.createdByAgentId,
    sourceType: input.task.sourceType ?? "TASK",
    sourceId: input.task.sourceId ?? input.task.id,
    type: input.type,
    title: input.type.replaceAll("_", " ").toLowerCase(),
    description: input.task.title,
    metadata: { taskId: input.task.id, status: input.task.status, priority: input.task.priority },
    correlationId: input.correlationId,
    visibility: "BUSINESS"
  };
}

export async function listTasks(
  actor: AuthenticatedUser,
  query: ListTasksQuery
): Promise<TaskDto[]> {
  const workspaceId = requireWorkspace(actor);
  if (query.leadId) await loadAuthorizedLead(actor, query.leadId, false);
  const records = await prisma.task.findMany({
    where: {
      workspaceId,
      leadId: query.leadId,
      status: query.status,
      lead: leadVisibilityWhere(actor)
    },
    include: taskInclude,
    orderBy: [{ status: "asc" }, { dueAt: "asc" }, { createdAt: "desc" }]
  });
  return records.map(toTaskDto);
}

export async function getTask(actor: AuthenticatedUser, taskId: string): Promise<TaskDto> {
  const task = await prisma.task.findFirst({
    where: { id: taskId, workspaceId: requireWorkspace(actor), lead: leadVisibilityWhere(actor) },
    include: taskInclude
  });
  if (!task) throw new AppError(404, "NOT_FOUND", "Task not found");
  return toTaskDto(task);
}

export async function createTask(
  actor: AuthenticatedUser,
  input: CreateTaskInput
): Promise<TaskDto> {
  const workspaceId = requireWorkspace(actor);
  const lead = await loadAuthorizedLead(actor, input.leadId, true);
  await assertWorkspaceAssignee(workspaceId, input.assignedToUserId);
  const correlationId = randomUUID();
  const task = await prisma.$transaction(async (tx) => {
    const projectionKey = input.isNextAction ? `lead:${lead.id}:next-action` : null;
    const data: Prisma.TaskUncheckedCreateInput = {
      workspaceId,
      leadId: lead.id,
      contactId: lead.contactId,
      companyId: lead.companyId,
      dealId: null,
      title: input.title,
      description: input.description,
      priority: input.priority,
      dueAt: input.dueAt ? new Date(input.dueAt) : null,
      reminderAt: input.reminderAt ? new Date(input.reminderAt) : null,
      assignedToUserId: input.assignedToUserId ?? lead.ownerId,
      createdByType: "USER",
      createdByUserId: actor.id,
      sourceType: "USER_TASK",
      sourceId: actor.id,
      isNextAction: input.isNextAction ?? false,
      projectionKey,
      correlationId
    };
    const created = input.isNextAction
      ? await tx.task.upsert({
          where: { projectionKey: projectionKey ?? "" },
          create: data,
          update: {
            ...data,
            status: "OPEN",
            completedAt: null,
            completedByType: null,
            completedByUserId: null
          }
        })
      : await tx.task.create({ data });
    if (input.isNextAction) {
      await tx.lead.update({
        where: { id: lead.id },
        data: { nextAction: created.title, nextActionAt: created.dueAt }
      });
    }
    await tx.activity.create({
      data: activityData({
        task: created,
        type: "TASK_CREATED",
        actorType: "USER",
        actorUserId: actor.id,
        correlationId
      })
    });
    await tx.auditEvent.create({
      data: {
        workspaceId,
        actorType: "USER",
        actorId: actor.id,
        actorUserId: actor.id,
        sourceType: "TASK_API",
        sourceId: created.id,
        entityType: "Task",
        entityId: created.id,
        action: "TASK_CREATED",
        after: { title: created.title, status: created.status, leadId: created.leadId },
        correlationId
      }
    });
    return tx.task.findUniqueOrThrow({ where: { id: created.id }, include: taskInclude });
  });
  await publishRealtimeEvent({
    entityType: "task",
    action: "task-created",
    leadId: lead.id,
    taskId: task.id
  });
  return toTaskDto(task);
}

export async function createAutomationTask(input: {
  leadId: string;
  title: string;
  description?: string | null;
  priority?: "LOW" | "NORMAL" | "HIGH" | "URGENT";
  dueAt?: Date | null;
  reminderAt?: Date | null;
  assignedToUserId?: string | null;
  createdByType: Exclude<TaskCreatorType, "USER">;
  createdByAgentId?: string | null;
  sourceType: string;
  sourceId?: string | null;
  correlationId?: string;
  isNextAction?: boolean;
  metadata?: Prisma.InputJsonValue;
}): Promise<TaskDto> {
  const lead = await prisma.lead.findUnique({ where: { id: input.leadId } });
  if (!lead?.workspaceId) throw new AppError(404, "NOT_FOUND", "Workspace-scoped lead not found");
  const workspaceId = lead.workspaceId;
  if (input.createdByType === "AGENT" && !input.createdByAgentId) {
    throw new AppError(400, "VALIDATION_ERROR", "Agent-created tasks require createdByAgentId");
  }
  await assertWorkspaceAssignee(workspaceId, input.assignedToUserId);
  const correlationId = input.correlationId ?? randomUUID();
  const task = await prisma.$transaction(async (tx) => {
    const projectionKey = input.isNextAction ? `lead:${lead.id}:next-action` : null;
    const data: Prisma.TaskUncheckedCreateInput = {
      workspaceId,
      leadId: lead.id,
      contactId: lead.contactId,
      companyId: lead.companyId,
      title: input.title,
      description: input.description,
      priority: input.priority,
      dueAt: input.dueAt,
      reminderAt: input.reminderAt,
      assignedToUserId: input.assignedToUserId ?? lead.ownerId,
      createdByType: input.createdByType,
      createdByAgentId: input.createdByAgentId,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      isNextAction: input.isNextAction ?? false,
      projectionKey,
      metadata: input.metadata,
      correlationId
    };
    const created = input.isNextAction
      ? await tx.task.upsert({
          where: { projectionKey: projectionKey ?? "" },
          create: data,
          update: {
            ...data,
            status: "OPEN",
            completedAt: null,
            completedByType: null,
            completedByUserId: null
          }
        })
      : await tx.task.create({ data });
    if (created.isNextAction) {
      await tx.lead.update({
        where: { id: lead.id },
        data: { nextAction: created.title, nextActionAt: created.dueAt }
      });
    }
    await tx.activity.create({
      data: activityData({
        task: created,
        type: "TASK_CREATED",
        actorType: input.createdByType,
        correlationId
      })
    });
    await tx.auditEvent.create({
      data: {
        workspaceId,
        actorType: input.createdByType,
        actorAgentId: input.createdByAgentId,
        sourceType: input.sourceType,
        sourceId: input.sourceId ?? created.id,
        entityType: "Task",
        entityId: created.id,
        action: "TASK_CREATED",
        after: { title: created.title, status: created.status, leadId: created.leadId },
        metadata: input.metadata,
        correlationId
      }
    });
    return tx.task.findUniqueOrThrow({ where: { id: created.id }, include: taskInclude });
  });
  await publishRealtimeEvent({
    entityType: "task",
    action: "task-created",
    leadId: lead.id,
    taskId: task.id
  });
  return toTaskDto(task);
}

async function loadMutableTask(actor: AuthenticatedUser, taskId: string) {
  const task = await prisma.task.findFirst({
    where: { id: taskId, workspaceId: requireWorkspace(actor) },
    include: { lead: true }
  });
  if (!task?.lead) throw new AppError(404, "NOT_FOUND", "Task not found");
  assertCanMutateLead(actor, task.lead);
  return task;
}

export async function updateTask(
  actor: AuthenticatedUser,
  taskId: string,
  input: UpdateTaskInput
): Promise<TaskDto> {
  const existing = await loadMutableTask(actor, taskId);
  const leadId = existing.leadId;
  if (!leadId) throw new AppError(400, "VALIDATION_ERROR", "Task is not related to a lead");
  await assertWorkspaceAssignee(existing.workspaceId, input.assignedToUserId);
  const correlationId = randomUUID();
  const task = await prisma.$transaction(async (tx) => {
    if (input.isNextAction) {
      await tx.task.updateMany({
        where: {
          leadId: existing.leadId,
          isNextAction: true,
          id: { not: taskId },
          status: { in: ["OPEN", "IN_PROGRESS"] }
        },
        data: { isNextAction: false, projectionKey: null }
      });
    }
    const updated = await tx.task.update({
      where: { id: taskId },
      data: {
        title: input.title,
        description: input.description,
        status: input.status,
        priority: input.priority,
        dueAt: input.dueAt === undefined ? undefined : input.dueAt ? new Date(input.dueAt) : null,
        reminderAt:
          input.reminderAt === undefined
            ? undefined
            : input.reminderAt
              ? new Date(input.reminderAt)
              : null,
        assignedToUserId: input.assignedToUserId,
        isNextAction: input.status === "CANCELED" ? false : input.isNextAction,
        projectionKey:
          input.status === "CANCELED"
            ? null
            : input.isNextAction === undefined
              ? undefined
              : input.isNextAction
                ? `lead:${leadId}:next-action`
                : null
      }
    });
    if (updated.isNextAction) {
      await tx.lead.update({
        where: { id: leadId },
        data: { nextAction: updated.title, nextActionAt: updated.dueAt }
      });
    } else if (
      existing.isNextAction &&
      (input.isNextAction === false || input.status === "CANCELED")
    ) {
      await tx.lead.update({
        where: { id: leadId },
        data: { nextAction: null, nextActionAt: null }
      });
    }
    await tx.activity.create({
      data: activityData({
        task: updated,
        type: "TASK_UPDATED",
        actorType: "USER",
        actorUserId: actor.id,
        correlationId
      })
    });
    await tx.auditEvent.create({
      data: {
        workspaceId: existing.workspaceId,
        actorType: "USER",
        actorId: actor.id,
        actorUserId: actor.id,
        sourceType: "TASK_API",
        sourceId: taskId,
        entityType: "Task",
        entityId: taskId,
        action: "TASK_UPDATED",
        before: { title: existing.title, status: existing.status },
        after: { title: updated.title, status: updated.status },
        correlationId
      }
    });
    return tx.task.findUniqueOrThrow({ where: { id: taskId }, include: taskInclude });
  });
  await publishRealtimeEvent({
    entityType: "task",
    action: "task-updated",
    leadId: existing.leadId,
    taskId
  });
  return toTaskDto(task);
}

export async function completeTask(actor: AuthenticatedUser, taskId: string): Promise<TaskDto> {
  const existing = await loadMutableTask(actor, taskId);
  const leadId = existing.leadId;
  if (!leadId) throw new AppError(400, "VALIDATION_ERROR", "Task is not related to a lead");
  if (existing.status === "COMPLETED") return getTask(actor, taskId);
  const correlationId = randomUUID();
  const task = await prisma.$transaction(async (tx) => {
    const completed = await tx.task.update({
      where: { id: taskId },
      data: {
        status: "COMPLETED",
        completedAt: new Date(),
        completedByType: "USER",
        completedByUserId: actor.id
      }
    });
    if (completed.isNextAction)
      await tx.lead.update({
        where: { id: leadId },
        data: { nextAction: null, nextActionAt: null }
      });
    await tx.activity.create({
      data: activityData({
        task: completed,
        type: "TASK_COMPLETED",
        actorType: "USER",
        actorUserId: actor.id,
        correlationId
      })
    });
    await tx.auditEvent.create({
      data: {
        workspaceId: existing.workspaceId,
        actorType: "USER",
        actorId: actor.id,
        actorUserId: actor.id,
        sourceType: "TASK_API",
        sourceId: taskId,
        entityType: "Task",
        entityId: taskId,
        action: "TASK_COMPLETED",
        before: { status: existing.status },
        after: { status: "COMPLETED" },
        correlationId
      }
    });
    return tx.task.findUniqueOrThrow({ where: { id: taskId }, include: taskInclude });
  });
  await publishRealtimeEvent({
    entityType: "task",
    action: "task-completed",
    leadId: existing.leadId,
    taskId
  });
  return toTaskDto(task);
}
