import { Router } from "express";
import { UserRole } from "@prisma/client";
import { asyncHandler } from "../../middleware/async-handler.js";
import { requireAuth, requireRole } from "../../middleware/auth.middleware.js";
import { validateBody } from "../../middleware/validate.middleware.js";
import {
  createLeadDocumentController,
  decideLeadFollowUpController,
  deleteLeadDocumentController,
  getAiCommandCenterController,
  getLeadIntelligenceController,
  refreshLeadIntelligenceController,
  updateLeadIntelligenceControlsController,
  uploadLeadDocumentController
} from "./lead-intelligence.controller.js";
import { parseLeadDocumentUpload } from "./lead-document-upload.js";
import {
  createLeadDocumentSchema,
  updateLeadIntelligenceControlsSchema
} from "./lead-intelligence.schemas.js";

export const leadIntelligenceRoutes = Router();

leadIntelligenceRoutes.use(requireAuth);
leadIntelligenceRoutes.get(
  "/command-center",
  requireRole([UserRole.ADMIN, UserRole.SALES_MANAGER]),
  asyncHandler(getAiCommandCenterController)
);
leadIntelligenceRoutes.get("/leads/:leadId", asyncHandler(getLeadIntelligenceController));
leadIntelligenceRoutes.post(
  "/leads/:leadId/refresh",
  asyncHandler(refreshLeadIntelligenceController)
);
leadIntelligenceRoutes.patch(
  "/leads/:leadId/controls",
  requireRole([UserRole.ADMIN, UserRole.SALES_MANAGER]),
  validateBody(updateLeadIntelligenceControlsSchema),
  asyncHandler(updateLeadIntelligenceControlsController)
);
leadIntelligenceRoutes.post("/leads/:leadId/decisions", asyncHandler(decideLeadFollowUpController));
leadIntelligenceRoutes.post(
  "/leads/:leadId/documents",
  requireRole([UserRole.ADMIN, UserRole.SALES_MANAGER]),
  validateBody(createLeadDocumentSchema),
  asyncHandler(createLeadDocumentController)
);
leadIntelligenceRoutes.post(
  "/leads/:leadId/documents/upload",
  requireRole([UserRole.ADMIN, UserRole.SALES_MANAGER]),
  parseLeadDocumentUpload,
  asyncHandler(uploadLeadDocumentController)
);
leadIntelligenceRoutes.delete(
  "/leads/:leadId/documents/:documentId",
  requireRole([UserRole.ADMIN, UserRole.SALES_MANAGER]),
  asyncHandler(deleteLeadDocumentController)
);
