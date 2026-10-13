import type { Request, Response } from "express";
import type {
  WorkflowDashboardDto,
  WorkflowDetailDto,
  WorkflowExecutionDto,
  WorkflowPreviewDto,
  WorkflowValidationDto
} from "@shilabs/shared-types";
import { getRequiredUser } from "../../middleware/auth.middleware.js";
import type {
  CreateWorkflowInput,
  ExecuteWorkflowInput,
  PreviewWorkflowInput,
  SaveWorkflowDraftInput,
  UpdateWorkflowInput,
  UpdateWorkflowStatusInput
} from "./workflow.schemas.js";
import {
  createWorkflow,
  executeWorkflow,
  getWorkflow,
  listWorkflows,
  previewWorkflow,
  publishWorkflow,
  saveWorkflowDraft,
  updateWorkflow,
  updateWorkflowStatus,
  validateWorkflow
} from "./workflow.service.js";

export async function listWorkflowsController(
  req: Request,
  res: Response<WorkflowDashboardDto>
): Promise<void> {
  res.json(await listWorkflows(getRequiredUser(req)));
}
export async function getWorkflowController(
  req: Request<{ id: string }>,
  res: Response<WorkflowDetailDto>
): Promise<void> {
  res.json(await getWorkflow(getRequiredUser(req), req.params.id));
}
export async function createWorkflowController(
  req: Request<Record<string, never>, WorkflowDetailDto, CreateWorkflowInput>,
  res: Response<WorkflowDetailDto>
): Promise<void> {
  res.status(201).json(await createWorkflow(getRequiredUser(req), req.body));
}
export async function updateWorkflowController(
  req: Request<{ id: string }, WorkflowDetailDto, UpdateWorkflowInput>,
  res: Response<WorkflowDetailDto>
): Promise<void> {
  res.json(await updateWorkflow(getRequiredUser(req), req.params.id, req.body));
}
export async function saveWorkflowDraftController(
  req: Request<{ id: string }, WorkflowDetailDto, SaveWorkflowDraftInput>,
  res: Response<WorkflowDetailDto>
): Promise<void> {
  res.json(await saveWorkflowDraft(getRequiredUser(req), req.params.id, req.body));
}
export async function validateWorkflowController(
  req: Request<{ id: string }>,
  res: Response<WorkflowValidationDto>
): Promise<void> {
  res.json(await validateWorkflow(getRequiredUser(req), req.params.id));
}
export async function previewWorkflowController(
  req: Request<{ id: string }, WorkflowPreviewDto, PreviewWorkflowInput>,
  res: Response<WorkflowPreviewDto>
): Promise<void> {
  res.json(await previewWorkflow(getRequiredUser(req), req.params.id, req.body));
}
export async function publishWorkflowController(
  req: Request<{ id: string }>,
  res: Response<WorkflowDetailDto>
): Promise<void> {
  res.json(await publishWorkflow(getRequiredUser(req), req.params.id));
}
export async function updateWorkflowStatusController(
  req: Request<{ id: string }, WorkflowDetailDto, UpdateWorkflowStatusInput>,
  res: Response<WorkflowDetailDto>
): Promise<void> {
  res.json(await updateWorkflowStatus(getRequiredUser(req), req.params.id, req.body));
}
export async function executeWorkflowController(
  req: Request<{ id: string }, WorkflowExecutionDto, ExecuteWorkflowInput>,
  res: Response<WorkflowExecutionDto>
): Promise<void> {
  res.status(202).json(await executeWorkflow(getRequiredUser(req), req.params.id, req.body));
}
