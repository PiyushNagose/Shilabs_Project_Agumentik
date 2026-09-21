import type { PipelineStage } from "@prisma/client";
import { prisma } from "../../shared/prisma.js";

export type PipelineStageRecord = Pick<
  PipelineStage,
  "id" | "key" | "label" | "order" | "probability" | "isClosed" | "isWon" | "isLost"
>;

export async function listPipelineStages(): Promise<PipelineStageRecord[]> {
  return prisma.pipelineStage.findMany({
    orderBy: { order: "asc" }
  });
}

export async function findPipelineStageById(stageId: string): Promise<PipelineStageRecord | null> {
  return prisma.pipelineStage.findUnique({
    where: { id: stageId }
  });
}
