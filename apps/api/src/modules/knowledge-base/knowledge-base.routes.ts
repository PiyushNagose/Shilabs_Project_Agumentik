import { Router } from "express";
import { UserRole } from "@prisma/client";
import { asyncHandler } from "../../middleware/async-handler.js";
import { requireAuth, requireRole } from "../../middleware/auth.middleware.js";
import { validateBody, validateQuery } from "../../middleware/validate.middleware.js";
import {
  correctKnowledgeBaseEntryController,
  createKnowledgeBaseEntryController,
  getKnowledgeBaseEntryController,
  listApprovedKnowledgeController,
  listKnowledgeBaseController,
  updateKnowledgeBaseEntryController
} from "./knowledge-base.controller.js";
import {
  approvedKnowledgeQuerySchema,
  createKnowledgeBaseCorrectionSchema,
  createKnowledgeBaseEntrySchema,
  listKnowledgeBaseQuerySchema,
  updateKnowledgeBaseEntrySchema
} from "./knowledge-base.schemas.js";

export const knowledgeBaseRoutes = Router();

knowledgeBaseRoutes.use(requireAuth);
knowledgeBaseRoutes.get(
  "/approved",
  validateQuery(approvedKnowledgeQuerySchema),
  asyncHandler(listApprovedKnowledgeController)
);
knowledgeBaseRoutes.get(
  "/",
  requireRole([UserRole.ADMIN, UserRole.SALES_MANAGER]),
  validateQuery(listKnowledgeBaseQuerySchema),
  asyncHandler(listKnowledgeBaseController)
);
knowledgeBaseRoutes.post(
  "/",
  requireRole([UserRole.ADMIN, UserRole.SALES_MANAGER]),
  validateBody(createKnowledgeBaseEntrySchema),
  asyncHandler(createKnowledgeBaseEntryController)
);
knowledgeBaseRoutes.get(
  "/:id",
  requireRole([UserRole.ADMIN, UserRole.SALES_MANAGER]),
  asyncHandler(getKnowledgeBaseEntryController)
);
knowledgeBaseRoutes.patch(
  "/:id",
  requireRole([UserRole.ADMIN, UserRole.SALES_MANAGER]),
  validateBody(updateKnowledgeBaseEntrySchema),
  asyncHandler(updateKnowledgeBaseEntryController)
);
knowledgeBaseRoutes.post(
  "/:id/corrections",
  requireRole([UserRole.ADMIN, UserRole.SALES_MANAGER]),
  validateBody(createKnowledgeBaseCorrectionSchema),
  asyncHandler(correctKnowledgeBaseEntryController)
);
