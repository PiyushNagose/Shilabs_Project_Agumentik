import { Router } from "express";
import { UserRole } from "@prisma/client";
import { z } from "zod";
import { AppError } from "../../shared/errors.js";
import { isInternalRealtimePublishAuthorized } from "../realtime/realtime.service.js";
import { prepareFollowUpDraft } from "./followup-draft.service.js";
import { asyncHandler } from "../../middleware/async-handler.js";
import { requireAuth, requireRole } from "../../middleware/auth.middleware.js";
import { validateBody } from "../../middleware/validate.middleware.js";
import {
  accelerateFollowUpSequenceForE2EController,
  listFollowUpSequencesForLeadController,
  runCallingAttemptNowForE2EController,
  startFollowUpSequenceController
} from "./followup.controller.js";
import { startFollowUpSequenceSchema } from "./followup.schemas.js";
import {
  createFollowUpPolicySchema,
  updateFollowUpPolicySchema
} from "./followup-policy.schemas.js";
import {
  createFollowUpPolicyController,
  deleteFollowUpPolicyController,
  listFollowUpPoliciesController,
  updateFollowUpPolicyController
} from "./followup-policy.controller.js";

export const followUpRoutes = Router();

followUpRoutes.post(
  "/internal/prepare",
  asyncHandler(async (request, response) => {
    if (!isInternalRealtimePublishAuthorized(request.header("x-shilabs-realtime-secret"))) {
      throw new AppError(401, "AUTHENTICATION_ERROR", "Follow-up preparation is not authorized");
    }
    const input = z
      .object({ workspaceId: z.string().min(1), attemptId: z.string().min(1) })
      .parse(request.body);
    response
      .set("Cache-Control", "no-store")
      .json(await prepareFollowUpDraft(input.workspaceId, input.attemptId));
  })
);
followUpRoutes.use(requireAuth);
followUpRoutes.get(
  "/policies",
  requireRole([UserRole.ADMIN, UserRole.SALES_MANAGER]),
  asyncHandler(listFollowUpPoliciesController)
);
followUpRoutes.post(
  "/policies",
  requireRole([UserRole.ADMIN, UserRole.SALES_MANAGER]),
  validateBody(createFollowUpPolicySchema),
  asyncHandler(createFollowUpPolicyController)
);
followUpRoutes.patch(
  "/policies/:policyId",
  requireRole([UserRole.ADMIN, UserRole.SALES_MANAGER]),
  validateBody(updateFollowUpPolicySchema),
  asyncHandler(updateFollowUpPolicyController)
);
followUpRoutes.delete(
  "/policies/:policyId",
  requireRole([UserRole.ADMIN, UserRole.SALES_MANAGER]),
  asyncHandler(deleteFollowUpPolicyController)
);
followUpRoutes.get(
  "/leads/:leadId",
  requireRole([UserRole.ADMIN, UserRole.SALES_MANAGER, UserRole.SALES_REP]),
  asyncHandler(listFollowUpSequencesForLeadController)
);
followUpRoutes.post(
  "/leads/:leadId/start",
  requireRole([UserRole.ADMIN, UserRole.SALES_MANAGER, UserRole.SALES_REP]),
  validateBody(startFollowUpSequenceSchema),
  asyncHandler(startFollowUpSequenceController)
);
followUpRoutes.post(
  "/leads/:leadId/calling/e2e/run-now",
  requireRole([UserRole.ADMIN]),
  asyncHandler(runCallingAttemptNowForE2EController)
);
followUpRoutes.post(
  "/sequences/:sequenceId/e2e/accelerate",
  requireRole([UserRole.ADMIN]),
  asyncHandler(accelerateFollowUpSequenceForE2EController)
);
