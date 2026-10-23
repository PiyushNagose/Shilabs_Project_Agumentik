import type { Request, Response } from "express";
import type {
  AiCommandCenterDto,
  LeadDocumentDto,
  LeadIntelligenceDecisionDto,
  LeadIntelligenceDto
} from "@shilabs/shared-types";
import { getRequiredUser } from "../../middleware/auth.middleware.js";
import { AppError } from "../../shared/errors.js";
import { prisma } from "../../shared/prisma.js";
import { assertCanMutateLead } from "../leads/lead.permissions.js";
import type {
  CreateLeadDocumentInput,
  UploadLeadDocumentInput,
  UpdateLeadIntelligenceControlsInput
} from "./lead-intelligence.schemas.js";
import { uploadLeadDocumentSchema } from "./lead-intelligence.schemas.js";
import { extractLeadDocumentUpload } from "./lead-document-upload.js";
import {
  createLeadDocument,
  decideLeadFollowUp,
  deleteLeadDocument,
  getAiCommandCenter,
  getLeadIntelligence,
  refreshLeadIntelligence,
  updateLeadIntelligenceControls
} from "./lead-intelligence.service.js";

export async function getLeadIntelligenceController(
  request: Request<{ leadId: string }>,
  response: Response<LeadIntelligenceDto>
): Promise<void> {
  response
    .status(200)
    .json(await getLeadIntelligence(getRequiredUser(request), request.params.leadId));
}

export async function refreshLeadIntelligenceController(
  request: Request<{ leadId: string }>,
  response: Response<LeadIntelligenceDto>
): Promise<void> {
  response
    .status(200)
    .json(await refreshLeadIntelligence(getRequiredUser(request), request.params.leadId));
}

export async function updateLeadIntelligenceControlsController(
  request: Request<{ leadId: string }, LeadIntelligenceDto, UpdateLeadIntelligenceControlsInput>,
  response: Response<LeadIntelligenceDto>
): Promise<void> {
  response
    .status(200)
    .json(
      await updateLeadIntelligenceControls(
        getRequiredUser(request),
        request.params.leadId,
        request.body
      )
    );
}

export async function decideLeadFollowUpController(
  request: Request<{ leadId: string }>,
  response: Response<LeadIntelligenceDecisionDto>
): Promise<void> {
  response
    .status(201)
    .json(await decideLeadFollowUp(getRequiredUser(request), request.params.leadId));
}

export async function createLeadDocumentController(
  request: Request<{ leadId: string }, LeadDocumentDto, CreateLeadDocumentInput>,
  response: Response<LeadDocumentDto>
): Promise<void> {
  response
    .status(201)
    .json(await createLeadDocument(getRequiredUser(request), request.params.leadId, request.body));
}

export async function uploadLeadDocumentController(
  request: Request<{ leadId: string }, LeadDocumentDto, UploadLeadDocumentInput>,
  response: Response<LeadDocumentDto>
): Promise<void> {
  const input = uploadLeadDocumentSchema.parse(request.body);
  const actor = getRequiredUser(request);
  const lead = await prisma.lead.findFirst({
    where: { id: request.params.leadId, workspaceId: actor.activeWorkspaceId ?? "" },
    select: { ownerId: true, workspaceId: true }
  });
  if (!lead) throw new AppError(404, "NOT_FOUND", "Lead not found");
  assertCanMutateLead(actor, lead);
  const extracted = await extractLeadDocumentUpload(request.file);
  response.status(201).json(
    await createLeadDocument(getRequiredUser(request), request.params.leadId, {
      ...input,
      sourceType: "UPLOAD",
      mimeType: extracted.mimeType,
      content: extracted.content
    })
  );
}

export async function deleteLeadDocumentController(
  request: Request<{ leadId: string; documentId: string }>,
  response: Response<void>
): Promise<void> {
  await deleteLeadDocument(
    getRequiredUser(request),
    request.params.leadId,
    request.params.documentId
  );
  response.status(204).send();
}

export async function getAiCommandCenterController(
  request: Request,
  response: Response<AiCommandCenterDto>
): Promise<void> {
  response.status(200).json(await getAiCommandCenter(getRequiredUser(request)));
}
