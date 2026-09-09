import type { Request, Response } from "express";
import type { LeadDto, PaginatedResponse } from "@shilabs/shared-types";
import { getRequiredUser } from "../../middleware/auth.middleware.js";
import type {
  AssignLeadInput,
  CreateLeadInput,
  ListLeadsQuery,
  UpdateLeadInput,
  UpdateLeadStatusInput
} from "./lead.schemas.js";
import {
  assignLead,
  createLead,
  getLead,
  listLeads,
  updateLead,
  updateLeadStatus
} from "./lead.service.js";

export async function createLeadController(
  request: Request<Record<string, never>, LeadDto, CreateLeadInput>,
  response: Response<LeadDto>
): Promise<void> {
  response.status(201).json(await createLead(getRequiredUser(request), request.body));
}

export async function listLeadsController(
  request: Request,
  response: Response<PaginatedResponse<LeadDto>>
): Promise<void> {
  response.status(200).json(await listLeads(request.validatedQuery as ListLeadsQuery));
}

export async function getLeadController(
  request: Request<{ id: string }>,
  response: Response<LeadDto>
): Promise<void> {
  response.status(200).json(await getLead(request.params.id));
}

export async function updateLeadController(
  request: Request<{ id: string }, LeadDto, UpdateLeadInput>,
  response: Response<LeadDto>
): Promise<void> {
  response
    .status(200)
    .json(await updateLead(getRequiredUser(request), request.params.id, request.body));
}

export async function assignLeadController(
  request: Request<{ id: string }, LeadDto, AssignLeadInput>,
  response: Response<LeadDto>
): Promise<void> {
  response
    .status(200)
    .json(await assignLead(getRequiredUser(request), request.params.id, request.body));
}

export async function updateLeadStatusController(
  request: Request<{ id: string }, LeadDto, UpdateLeadStatusInput>,
  response: Response<LeadDto>
): Promise<void> {
  response
    .status(200)
    .json(await updateLeadStatus(getRequiredUser(request), request.params.id, request.body));
}
