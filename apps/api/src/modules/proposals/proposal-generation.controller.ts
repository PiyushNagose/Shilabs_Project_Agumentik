import type { Request, Response } from "express";
import type { ProposalGenerationResultDto } from "@shilabs/shared-types";
import { getRequiredUser } from "../../middleware/auth.middleware.js";
import { generateProposal } from "./proposal-generation.service.js";
import type { GenerateProposalInput } from "./proposal-generation.schemas.js";

export async function generateProposalController(
  request: Request<Record<string, never>, ProposalGenerationResultDto, GenerateProposalInput>,
  response: Response<ProposalGenerationResultDto>
): Promise<void> {
  response.status(201).json(await generateProposal(getRequiredUser(request), request.body));
}
