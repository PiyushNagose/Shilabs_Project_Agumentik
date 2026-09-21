import type { Request, Response } from "express";
import type { ApprovedKnowledgeDto, KnowledgeBaseEntryDto } from "@shilabs/shared-types";
import { getRequiredUser } from "../../middleware/auth.middleware.js";
import {
  correctKnowledgeBaseEntry,
  createKnowledgeBaseEntry,
  getKnowledgeBaseEntry,
  listApprovedKnowledge,
  listKnowledgeBase,
  updateKnowledgeBaseEntry
} from "./knowledge-base.service.js";
import type {
  ApprovedKnowledgeQuery,
  CreateKnowledgeBaseCorrectionInput,
  CreateKnowledgeBaseEntryInput,
  ListKnowledgeBaseQuery,
  UpdateKnowledgeBaseEntryInput
} from "./knowledge-base.schemas.js";

export async function listKnowledgeBaseController(
  request: Request,
  response: Response<KnowledgeBaseEntryDto[]>
): Promise<void> {
  response
    .status(200)
    .json(await listKnowledgeBase(request.validatedQuery as ListKnowledgeBaseQuery));
}

export async function listApprovedKnowledgeController(
  request: Request,
  response: Response<ApprovedKnowledgeDto[]>
): Promise<void> {
  response
    .status(200)
    .json(await listApprovedKnowledge(request.validatedQuery as ApprovedKnowledgeQuery));
}

export async function getKnowledgeBaseEntryController(
  request: Request<{ id: string }>,
  response: Response<KnowledgeBaseEntryDto>
): Promise<void> {
  response.status(200).json(await getKnowledgeBaseEntry(request.params.id));
}

export async function createKnowledgeBaseEntryController(
  request: Request<Record<string, never>, KnowledgeBaseEntryDto, CreateKnowledgeBaseEntryInput>,
  response: Response<KnowledgeBaseEntryDto>
): Promise<void> {
  response
    .status(201)
    .json(await createKnowledgeBaseEntry(getRequiredUser(request), request.body));
}

export async function updateKnowledgeBaseEntryController(
  request: Request<{ id: string }, KnowledgeBaseEntryDto, UpdateKnowledgeBaseEntryInput>,
  response: Response<KnowledgeBaseEntryDto>
): Promise<void> {
  response
    .status(200)
    .json(await updateKnowledgeBaseEntry(getRequiredUser(request), request.params.id, request.body));
}

export async function correctKnowledgeBaseEntryController(
  request: Request<{ id: string }, KnowledgeBaseEntryDto, CreateKnowledgeBaseCorrectionInput>,
  response: Response<KnowledgeBaseEntryDto>
): Promise<void> {
  response
    .status(200)
    .json(await correctKnowledgeBaseEntry(getRequiredUser(request), request.params.id, request.body));
}
