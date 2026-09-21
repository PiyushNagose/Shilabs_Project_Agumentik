import type { Request, Response } from "express";
import type {
  LeadScoreOverrideDto,
  LeadScoreResultDto,
  ScoringConfigDto
} from "@shilabs/shared-types";
import { getRequiredUser } from "../../middleware/auth.middleware.js";
import type { OverrideLeadScoreInput, UpdateScoringConfigInput } from "./scoring.schemas.js";
import {
  getScoringConfig,
  overrideLeadScore,
  recalculateLeadScore,
  updateScoringConfig
} from "./scoring.service.js";

export async function getScoringConfigController(
  _request: Request,
  response: Response<ScoringConfigDto>
): Promise<void> {
  response.status(200).json(await getScoringConfig());
}

export async function updateScoringConfigController(
  request: Request<Record<string, never>, ScoringConfigDto, UpdateScoringConfigInput>,
  response: Response<ScoringConfigDto>
): Promise<void> {
  response.status(200).json(await updateScoringConfig(getRequiredUser(request), request.body));
}

export async function recalculateLeadScoreController(
  request: Request<{ id: string }>,
  response: Response<LeadScoreResultDto>
): Promise<void> {
  response
    .status(200)
    .json(await recalculateLeadScore(getRequiredUser(request), request.params.id));
}

export async function overrideLeadScoreController(
  request: Request<{ id: string }, LeadScoreOverrideDto, OverrideLeadScoreInput>,
  response: Response<LeadScoreOverrideDto>
): Promise<void> {
  response
    .status(200)
    .json(await overrideLeadScore(getRequiredUser(request), request.params.id, request.body));
}
