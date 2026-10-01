import type { Request, Response } from "express";
import type { AgentCorrectionDto } from "@shilabs/shared-types";
import { getRequiredUser } from "../../middleware/auth.middleware.js";
import {
  createAgentCorrection,
  createProposalAgentCorrection,
  listAgentCorrections
} from "./agent-feedback.service.js";
import type {
  CreateAgentCorrectionInput,
  CreateProposalCorrectionInput,
  ListAgentCorrectionsQuery
} from "./agent-feedback.schemas.js";

export async function createAgentCorrectionController(
  request: Request<never, AgentCorrectionDto, CreateAgentCorrectionInput>,
  response: Response<AgentCorrectionDto>
): Promise<void> {
  response.status(201).json(await createAgentCorrection(getRequiredUser(request), request.body));
}

export async function createProposalAgentCorrectionController(
  request: Request<{ proposalId: string }, AgentCorrectionDto, CreateProposalCorrectionInput>,
  response: Response<AgentCorrectionDto>
): Promise<void> {
  response
    .status(201)
    .json(await createProposalAgentCorrection(getRequiredUser(request), request.params.proposalId, request.body));
}

export async function listAgentCorrectionsController(
  request: Request,
  response: Response<AgentCorrectionDto[]>
): Promise<void> {
  response
    .status(200)
    .json(await listAgentCorrections(request.validatedQuery as ListAgentCorrectionsQuery));
}
