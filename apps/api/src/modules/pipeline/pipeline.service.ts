import type { PipelineStageDto } from "@shilabs/shared-types";
import {
  listPipelineStages as listPipelineStageRecords,
  type PipelineStageRecord
} from "./pipeline.repository.js";

export function toPipelineStageDto(stage: PipelineStageRecord): PipelineStageDto {
  return {
    id: stage.id,
    key: stage.key,
    label: stage.label,
    order: stage.order,
    probability: stage.probability,
    isClosed: stage.isClosed,
    isWon: stage.isWon,
    isLost: stage.isLost
  };
}

export async function listPipelineStages(): Promise<PipelineStageDto[]> {
  return (await listPipelineStageRecords()).map(toPipelineStageDto);
}
