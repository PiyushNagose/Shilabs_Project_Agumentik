import type { Request, Response } from "express";
import type { PipelineStageDto } from "@shilabs/shared-types";
import { listPipelineStages } from "./pipeline.service.js";

export async function listPipelineStagesController(
  _request: Request,
  response: Response<PipelineStageDto[]>
): Promise<void> {
  response.status(200).json(await listPipelineStages());
}
