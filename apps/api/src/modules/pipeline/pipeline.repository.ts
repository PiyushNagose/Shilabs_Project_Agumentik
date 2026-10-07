import type { Prisma } from "@prisma/client";
import { prisma } from "../../shared/prisma.js";

export const pipelineInclude = {
  stages: { orderBy: [{ position: "asc" }, { order: "asc" }] }
} satisfies Prisma.PipelineInclude;

export type PipelineRecord = Prisma.PipelineGetPayload<{ include: typeof pipelineInclude }>;
export type PipelineStageRecord = Prisma.PipelineStageGetPayload<Record<string, never>>;

export function listPipelineRecords(workspaceId: string): Promise<PipelineRecord[]> {
  return prisma.pipeline.findMany({
    where: { workspaceId },
    include: pipelineInclude,
    orderBy: [{ isDefault: "desc" }, { name: "asc" }]
  });
}

export function findPipelineById(workspaceId: string, pipelineId: string): Promise<PipelineRecord | null> {
  return prisma.pipeline.findFirst({ where: { id: pipelineId, workspaceId }, include: pipelineInclude });
}

export function listPipelineStages(workspaceId: string, pipelineId?: string): Promise<PipelineStageRecord[]> {
  return prisma.pipelineStage.findMany({
    where: { workspaceId, status: "ACTIVE", pipeline: { status: "ACTIVE" }, ...(pipelineId ? { pipelineId } : {}) },
    orderBy: [{ position: "asc" }, { order: "asc" }]
  });
}

export function findPipelineStageById(stageId: string, workspaceId?: string): Promise<PipelineStageRecord | null> {
  return prisma.pipelineStage.findFirst({ where: { id: stageId, ...(workspaceId ? { workspaceId } : {}) } });
}
