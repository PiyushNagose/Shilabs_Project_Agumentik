import type { Request, Response } from "express";
import type { FollowUpPolicyDto } from "@shilabs/shared-types";
import { getRequiredUser } from "../../middleware/auth.middleware.js";
import type {
  CreateFollowUpPolicyInput,
  UpdateFollowUpPolicyInput
} from "./followup-policy.schemas.js";
import {
  createFollowUpPolicy,
  deleteFollowUpPolicy,
  listFollowUpPolicies,
  updateFollowUpPolicy
} from "./followup-policy.service.js";

export async function listFollowUpPoliciesController(
  request: Request,
  response: Response<FollowUpPolicyDto[]>
): Promise<void> {
  response.status(200).json(await listFollowUpPolicies(getRequiredUser(request)));
}

export async function createFollowUpPolicyController(
  request: Request<Record<string, never>, FollowUpPolicyDto, CreateFollowUpPolicyInput>,
  response: Response<FollowUpPolicyDto>
): Promise<void> {
  response.status(201).json(await createFollowUpPolicy(getRequiredUser(request), request.body));
}

export async function updateFollowUpPolicyController(
  request: Request<{ policyId: string }, FollowUpPolicyDto, UpdateFollowUpPolicyInput>,
  response: Response<FollowUpPolicyDto>
): Promise<void> {
  response
    .status(200)
    .json(
      await updateFollowUpPolicy(getRequiredUser(request), request.params.policyId, request.body)
    );
}

export async function deleteFollowUpPolicyController(
  request: Request<{ policyId: string }>,
  response: Response
): Promise<void> {
  await deleteFollowUpPolicy(getRequiredUser(request), request.params.policyId);
  response.status(204).send();
}
