import type { Request, Response } from "express";
import type { PipelineDto, PipelineStageDto } from "@shilabs/shared-types";
import { getRequiredUser } from "../../middleware/auth.middleware.js";
import { createPipeline, createPipelineStage, listPipelines, listPipelineStages, reorderPipelineStages, updatePipeline, updatePipelineStage } from "./pipeline.service.js";
import type { CreatePipelineInput, CreatePipelineStageInput, ReorderPipelineStagesInput, UpdatePipelineInput, UpdatePipelineStageInput } from "./pipeline.schemas.js";

export async function listPipelinesController(request: Request, response: Response<PipelineDto[]>): Promise<void> {
  response.status(200).json(await listPipelines(getRequiredUser(request)));
}
export async function listPipelineStagesController(request: Request<Record<string, never>, PipelineStageDto[], never, { pipelineId?: string }>, response: Response<PipelineStageDto[]>): Promise<void> {
  response.status(200).json(await listPipelineStages(getRequiredUser(request), request.query.pipelineId));
}
export async function createPipelineController(request: Request<Record<string, never>, PipelineDto, CreatePipelineInput>, response: Response<PipelineDto>): Promise<void> {
  response.status(201).json(await createPipeline(getRequiredUser(request), request.body));
}
export async function updatePipelineController(request: Request<{ id: string }, PipelineDto, UpdatePipelineInput>, response: Response<PipelineDto>): Promise<void> {
  response.status(200).json(await updatePipeline(getRequiredUser(request), request.params.id, request.body));
}
export async function createPipelineStageController(request: Request<{ id: string }, PipelineStageDto, CreatePipelineStageInput>, response: Response<PipelineStageDto>): Promise<void> {
  response.status(201).json(await createPipelineStage(getRequiredUser(request), request.params.id, request.body));
}
export async function updatePipelineStageController(request: Request<{ id: string }, PipelineStageDto, UpdatePipelineStageInput>, response: Response<PipelineStageDto>): Promise<void> {
  response.status(200).json(await updatePipelineStage(getRequiredUser(request), request.params.id, request.body));
}
export async function reorderPipelineStagesController(request: Request<{ id: string }, PipelineDto, ReorderPipelineStagesInput>, response: Response<PipelineDto>): Promise<void> {
  response.status(200).json(await reorderPipelineStages(getRequiredUser(request), request.params.id, request.body));
}
