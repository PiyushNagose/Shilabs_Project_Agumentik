import { randomUUID } from "node:crypto";
import { UserRole, type Prisma } from "@prisma/client";
import type { PipelineDto, PipelineStageDto } from "@shilabs/shared-types";
import { AppError } from "../../shared/errors.js";
import { prisma } from "../../shared/prisma.js";
import type { AuthenticatedUser } from "../auth/auth.types.js";
import { publishRealtimeEvent } from "../realtime/realtime.service.js";
import type { CreatePipelineInput, CreatePipelineStageInput, ReorderPipelineStagesInput, UpdatePipelineInput, UpdatePipelineStageInput } from "./pipeline.schemas.js";
import { findPipelineById, listPipelineRecords, listPipelineStages as listStageRecords, pipelineInclude, type PipelineRecord, type PipelineStageRecord } from "./pipeline.repository.js";

function requireWorkspace(actor: AuthenticatedUser): string {
  if (!actor.activeWorkspaceId) throw new AppError(403, "AUTHORIZATION_ERROR", "Active workspace required");
  return actor.activeWorkspaceId;
}

function assertCanManage(actor: AuthenticatedUser): void {
  if (actor.role !== UserRole.ADMIN && actor.role !== UserRole.SALES_MANAGER) {
    throw new AppError(403, "AUTHORIZATION_ERROR", "Pipeline management requires manager access");
  }
}

export function toPipelineStageDto(stage: PipelineStageRecord): PipelineStageDto {
  return { id: stage.id, pipelineId: stage.pipelineId, key: stage.semanticKey ?? stage.key, label: stage.label, order: stage.order, position: stage.position, probability: stage.probability, color: stage.color, status: stage.status, isClosed: stage.isClosed, isWon: stage.isWon, isLost: stage.isLost };
}

function toPipelineDto(pipeline: PipelineRecord): PipelineDto {
  return { id: pipeline.id, name: pipeline.name, type: pipeline.type, isDefault: pipeline.isDefault, status: pipeline.status, createdAt: pipeline.createdAt.toISOString(), updatedAt: pipeline.updatedAt.toISOString(), stages: pipeline.stages.map(toPipelineStageDto) };
}

async function audit(input: { workspaceId: string; actorId: string; entityType: string; entityId: string; action: string; before?: Prisma.InputJsonValue; after?: Prisma.InputJsonValue }): Promise<void> {
  await prisma.auditEvent.create({ data: { workspaceId: input.workspaceId, actorType: "USER", actorId: input.actorId, actorUserId: input.actorId, sourceType: "CRM", entityType: input.entityType, entityId: input.entityId, action: input.action, before: input.before, after: input.after } });
}

export async function ensureWorkspacePipeline(workspaceId: string): Promise<PipelineRecord> {
  const existing = await prisma.pipeline.findFirst({ where: { workspaceId, isDefault: true }, include: pipelineInclude });
  if (existing) {
    const unattached = await prisma.pipelineStage.findMany({ where: { workspaceId, pipelineId: null }, orderBy: [{ order: "asc" }, { id: "asc" }] });
    if (unattached.length === 0) return existing;
    return prisma.$transaction(async (tx) => {
      const usedSemanticKeys = new Set(existing.stages.flatMap((stage) => stage.semanticKey ? [stage.semanticKey] : []));
      for (const [offset, stage] of unattached.entries()) {
        const candidate = stage.semanticKey ?? stage.key;
        const semanticKey = usedSemanticKeys.has(candidate) ? null : candidate;
        if (semanticKey) usedSemanticKeys.add(semanticKey);
        await tx.pipelineStage.update({ where: { id: stage.id }, data: { pipelineId: existing.id, position: existing.stages.length + offset, semanticKey } });
      }
      return tx.pipeline.findUniqueOrThrow({ where: { id: existing.id }, include: pipelineInclude });
    });
  }
  return prisma.$transaction(async (tx) => {
    const pipeline = await tx.pipeline.create({ data: { workspaceId, name: "Sales Pipeline", type: "SALES", isDefault: true }, include: pipelineInclude });
    const unattached = await tx.pipelineStage.findMany({ where: { workspaceId, pipelineId: null }, orderBy: { order: "asc" } });
    for (const [position, stage] of unattached.entries()) {
      await tx.pipelineStage.update({ where: { id: stage.id }, data: { pipelineId: pipeline.id, position } });
    }
    if (unattached.length === 0) {
      const templates = await tx.pipelineStage.findMany({ where: { workspaceId: { not: workspaceId }, semanticKey: { not: null } }, distinct: ["semanticKey"], orderBy: { order: "asc" } });
      const maximum = await tx.pipelineStage.aggregate({ _max: { order: true } });
      for (const [position, template] of templates.entries()) {
        await tx.pipelineStage.create({ data: { workspaceId, pipelineId: pipeline.id, key: `P5_${randomUUID().replaceAll("-", "").toUpperCase()}`, semanticKey: template.semanticKey, label: template.label, order: (maximum._max.order ?? 0) + position + 1, position, probability: template.probability, color: template.color, isClosed: template.isClosed, isWon: template.isWon, isLost: template.isLost } });
      }
    }
    return tx.pipeline.findUniqueOrThrow({ where: { id: pipeline.id }, include: pipelineInclude });
  });
}

export async function listPipelines(actor: AuthenticatedUser): Promise<PipelineDto[]> {
  const workspaceId = requireWorkspace(actor);
  if ((await prisma.pipeline.count({ where: { workspaceId } })) === 0) await ensureWorkspacePipeline(workspaceId);
  return (await listPipelineRecords(workspaceId)).map(toPipelineDto);
}

export async function listPipelineStages(actor: AuthenticatedUser, pipelineId?: string): Promise<PipelineStageDto[]> {
  const workspaceId = requireWorkspace(actor);
  if (pipelineId && !(await findPipelineById(workspaceId, pipelineId))) throw new AppError(404, "NOT_FOUND", "Pipeline not found");
  if (!pipelineId) await ensureWorkspacePipeline(workspaceId);
  return (await listStageRecords(workspaceId, pipelineId)).map(toPipelineStageDto);
}

export async function createPipeline(actor: AuthenticatedUser, input: CreatePipelineInput): Promise<PipelineDto> {
  assertCanManage(actor);
  const workspaceId = requireWorkspace(actor);
  const pipeline = await prisma.pipeline.create({ data: { workspaceId, name: input.name, type: input.type, isDefault: input.isDefault ?? false }, include: pipelineInclude });
  await audit({ workspaceId, actorId: actor.id, entityType: "Pipeline", entityId: pipeline.id, action: "PIPELINE_CREATED", after: { name: pipeline.name } });
  await publishRealtimeEvent({ entityType: "pipeline", action: "pipeline-created", workspaceId });
  return toPipelineDto(pipeline);
}

export async function updatePipeline(actor: AuthenticatedUser, pipelineId: string, input: UpdatePipelineInput): Promise<PipelineDto> {
  assertCanManage(actor);
  const workspaceId = requireWorkspace(actor);
  const existing = await findPipelineById(workspaceId, pipelineId);
  if (!existing) throw new AppError(404, "NOT_FOUND", "Pipeline not found");
  if (existing.isDefault && input.status === "ARCHIVED") throw new AppError(409, "CONFLICT", "Default pipeline cannot be archived");
  if (input.status === "ARCHIVED" && (await prisma.deal.count({ where: { workspaceId, pipelineId, status: "OPEN" } })) > 0) {
    throw new AppError(409, "CONFLICT", "Move or close open deals before archiving this pipeline");
  }
  const pipeline = await prisma.pipeline.update({ where: { id: existing.id }, data: { name: input.name, status: input.status }, include: pipelineInclude });
  await audit({ workspaceId, actorId: actor.id, entityType: "Pipeline", entityId: pipeline.id, action: "PIPELINE_UPDATED", before: { name: existing.name, status: existing.status }, after: { name: pipeline.name, status: pipeline.status } });
  await publishRealtimeEvent({ entityType: "pipeline", action: "pipeline-updated", workspaceId });
  return toPipelineDto(pipeline);
}

export async function createPipelineStage(actor: AuthenticatedUser, pipelineId: string, input: CreatePipelineStageInput): Promise<PipelineStageDto> {
  assertCanManage(actor);
  const workspaceId = requireWorkspace(actor);
  const pipeline = await findPipelineById(workspaceId, pipelineId);
  if (!pipeline) throw new AppError(404, "NOT_FOUND", "Pipeline not found");
  if (pipeline.status === "ARCHIVED") throw new AppError(409, "CONFLICT", "Reactivate the pipeline before adding stages");
  const maxOrder = await prisma.pipelineStage.aggregate({ _max: { order: true } });
  const stage = await prisma.pipelineStage.create({ data: { workspaceId, pipelineId, key: `P5_${randomUUID().replaceAll("-", "").toUpperCase()}`, semanticKey: null, label: input.name, order: (maxOrder._max.order ?? -1) + 1, position: pipeline.stages.length, probability: input.probability, color: input.color ?? null, isClosed: input.isWon || input.isLost, isWon: input.isWon, isLost: input.isLost } });
  await audit({ workspaceId, actorId: actor.id, entityType: "PipelineStage", entityId: stage.id, action: "PIPELINE_STAGE_CREATED", after: { pipelineId, name: stage.label, position: stage.position } });
  await publishRealtimeEvent({ entityType: "pipeline", action: "pipeline-stage-created", workspaceId });
  return toPipelineStageDto(stage);
}

export async function updatePipelineStage(actor: AuthenticatedUser, stageId: string, input: UpdatePipelineStageInput): Promise<PipelineStageDto> {
  assertCanManage(actor);
  const workspaceId = requireWorkspace(actor);
  const existing = await prisma.pipelineStage.findFirst({ where: { id: stageId, workspaceId } });
  if (!existing) throw new AppError(404, "NOT_FOUND", "Pipeline stage not found");
  if (input.status === "ARCHIVED" && (await prisma.deal.count({ where: { workspaceId, stageId, status: "OPEN" } })) > 0) throw new AppError(409, "CONFLICT", "Move open deals before archiving this stage");
  const stage = await prisma.pipelineStage.update({ where: { id: existing.id }, data: { label: input.name, probability: input.probability, color: input.color, status: input.status } });
  await audit({ workspaceId, actorId: actor.id, entityType: "PipelineStage", entityId: stage.id, action: "PIPELINE_STAGE_UPDATED", before: { name: existing.label, probability: existing.probability, status: existing.status }, after: { name: stage.label, probability: stage.probability, status: stage.status } });
  await publishRealtimeEvent({ entityType: "pipeline", action: "pipeline-stage-updated", workspaceId });
  return toPipelineStageDto(stage);
}

export async function reorderPipelineStages(actor: AuthenticatedUser, pipelineId: string, input: ReorderPipelineStagesInput): Promise<PipelineDto> {
  assertCanManage(actor);
  const workspaceId = requireWorkspace(actor);
  const pipeline = await findPipelineById(workspaceId, pipelineId);
  if (!pipeline) throw new AppError(404, "NOT_FOUND", "Pipeline not found");
  const existingIds = pipeline.stages.map((stage) => stage.id).sort();
  if (input.stageIds.length !== existingIds.length || [...input.stageIds].sort().some((id, index) => id !== existingIds[index])) throw new AppError(400, "VALIDATION_ERROR", "stageIds must contain every stage in this pipeline exactly once");
  await prisma.$transaction(input.stageIds.map((id, position) => prisma.pipelineStage.update({ where: { id }, data: { position } })));
  await audit({ workspaceId, actorId: actor.id, entityType: "Pipeline", entityId: pipelineId, action: "PIPELINE_STAGES_REORDERED", after: { stageIds: input.stageIds } });
  await publishRealtimeEvent({ entityType: "pipeline", action: "pipeline-stages-reordered", workspaceId });
  const updated = await findPipelineById(workspaceId, pipelineId);
  if (!updated) throw new AppError(404, "NOT_FOUND", "Pipeline not found after reordering");
  return toPipelineDto(updated);
}
