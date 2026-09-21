import { Router } from "express";
import { UserRole } from "@prisma/client";
import { asyncHandler } from "../../middleware/async-handler.js";
import { requireAuth, requireRole } from "../../middleware/auth.middleware.js";
import { validateBody, validateQuery } from "../../middleware/validate.middleware.js";
import {
  approveProposalController,
  createProposalController,
  getProposalController,
  listProposalsController,
  sendApprovedProposalController,
  submitProposalForApprovalController,
  updateProposalDraftController
} from "./proposal.controller.js";
import { generateProposalController } from "./proposal-generation.controller.js";
import { generateProposalSchema } from "./proposal-generation.schemas.js";
import {
  approveProposalSchema,
  createProposalSchema,
  listProposalsQuerySchema,
  sendApprovedProposalSchema,
  submitProposalForApprovalSchema,
  updateProposalDraftSchema
} from "./proposal.schemas.js";

export const proposalRoutes = Router();

proposalRoutes.use(requireAuth);
proposalRoutes.get(
  "/",
  validateQuery(listProposalsQuerySchema),
  asyncHandler(listProposalsController)
);
proposalRoutes.post(
  "/",
  requireRole([UserRole.ADMIN, UserRole.SALES_MANAGER, UserRole.SALES_REP]),
  validateBody(createProposalSchema),
  asyncHandler(createProposalController)
);
proposalRoutes.post(
  "/generate",
  requireRole([UserRole.ADMIN, UserRole.SALES_MANAGER, UserRole.SALES_REP]),
  validateBody(generateProposalSchema),
  asyncHandler(generateProposalController)
);
proposalRoutes.get("/:id", asyncHandler(getProposalController));
proposalRoutes.patch(
  "/:id/draft",
  requireRole([UserRole.ADMIN, UserRole.SALES_MANAGER, UserRole.SALES_REP]),
  validateBody(updateProposalDraftSchema),
  asyncHandler(updateProposalDraftController)
);
proposalRoutes.post(
  "/:id/submit",
  requireRole([UserRole.ADMIN, UserRole.SALES_MANAGER, UserRole.SALES_REP]),
  validateBody(submitProposalForApprovalSchema),
  asyncHandler(submitProposalForApprovalController)
);
proposalRoutes.post(
  "/:id/approve",
  requireRole([UserRole.ADMIN, UserRole.SALES_MANAGER]),
  validateBody(approveProposalSchema),
  asyncHandler(approveProposalController)
);
proposalRoutes.post(
  "/:id/send",
  requireRole([UserRole.ADMIN, UserRole.SALES_MANAGER]),
  validateBody(sendApprovedProposalSchema),
  asyncHandler(sendApprovedProposalController)
);
