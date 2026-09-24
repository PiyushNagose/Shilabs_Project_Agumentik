import { Router } from "express";
import { UserRole } from "@prisma/client";
import { asyncHandler } from "../../middleware/async-handler.js";
import { requireAuth, requireRole } from "../../middleware/auth.middleware.js";
import { validateBody, validateQuery } from "../../middleware/validate.middleware.js";
import {
  createAgentCorrectionController,
  createProposalAgentCorrectionController,
  listAgentCorrectionsController
} from "./agent-feedback.controller.js";
import {
  createAgentCorrectionSchema,
  createProposalCorrectionSchema,
  listAgentCorrectionsQuerySchema
} from "./agent-feedback.schemas.js";

export const agentFeedbackRoutes = Router();

agentFeedbackRoutes.use(requireAuth);

agentFeedbackRoutes.get(
  "/corrections",
  validateQuery(listAgentCorrectionsQuerySchema),
  asyncHandler(listAgentCorrectionsController)
);

agentFeedbackRoutes.post(
  "/corrections",
  requireRole([UserRole.ADMIN, UserRole.SALES_MANAGER, UserRole.SALES_REP]),
  validateBody(createAgentCorrectionSchema),
  asyncHandler(createAgentCorrectionController)
);

agentFeedbackRoutes.post(
  "/proposals/:proposalId/corrections",
  requireRole([UserRole.ADMIN, UserRole.SALES_MANAGER, UserRole.SALES_REP]),
  validateBody(createProposalCorrectionSchema),
  asyncHandler(createProposalAgentCorrectionController)
);
