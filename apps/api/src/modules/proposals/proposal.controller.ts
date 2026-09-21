import type { Request, Response } from "express";
import type { ProposalDto, ProposalSendResultDto } from "@shilabs/shared-types";
import { getRequiredUser } from "../../middleware/auth.middleware.js";
import {
  approveProposal,
  createProposal,
  getProposal,
  listProposals,
  submitProposalForApproval,
  updateProposalDraft
} from "./proposal.service.js";
import { sendApprovedProposal } from "./proposal-send.service.js";
import type {
  ApproveProposalInput,
  CreateProposalInput,
  ListProposalsQuery,
  SendApprovedProposalInput,
  SubmitProposalForApprovalInput,
  UpdateProposalDraftInput
} from "./proposal.schemas.js";

export async function listProposalsController(
  request: Request,
  response: Response<ProposalDto[]>
): Promise<void> {
  response.status(200).json(await listProposals(request.validatedQuery as ListProposalsQuery));
}

export async function getProposalController(
  request: Request<{ id: string }>,
  response: Response<ProposalDto>
): Promise<void> {
  response.status(200).json(await getProposal(request.params.id));
}

export async function createProposalController(
  request: Request<Record<string, never>, ProposalDto, CreateProposalInput>,
  response: Response<ProposalDto>
): Promise<void> {
  response.status(201).json(await createProposal(getRequiredUser(request), request.body));
}

export async function updateProposalDraftController(
  request: Request<{ id: string }, ProposalDto, UpdateProposalDraftInput>,
  response: Response<ProposalDto>
): Promise<void> {
  response
    .status(200)
    .json(await updateProposalDraft(getRequiredUser(request), request.params.id, request.body));
}

export async function submitProposalForApprovalController(
  request: Request<{ id: string }, ProposalDto, SubmitProposalForApprovalInput>,
  response: Response<ProposalDto>
): Promise<void> {
  response
    .status(200)
    .json(
      await submitProposalForApproval(getRequiredUser(request), request.params.id, request.body)
    );
}

export async function approveProposalController(
  request: Request<{ id: string }, ProposalDto, ApproveProposalInput>,
  response: Response<ProposalDto>
): Promise<void> {
  response
    .status(200)
    .json(await approveProposal(getRequiredUser(request), request.params.id, request.body));
}

export async function sendApprovedProposalController(
  request: Request<{ id: string }, ProposalSendResultDto, SendApprovedProposalInput>,
  response: Response<ProposalSendResultDto>
): Promise<void> {
  response
    .status(200)
    .json(await sendApprovedProposal(getRequiredUser(request), request.params.id, request.body));
}
