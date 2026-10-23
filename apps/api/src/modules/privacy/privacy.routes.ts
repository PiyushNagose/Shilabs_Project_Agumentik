import { Router } from "express";
import { UserRole } from "@prisma/client";
import { requireAuth, requireRole, getRequiredUser } from "../../middleware/auth.middleware.js";
import { asyncHandler } from "../../middleware/async-handler.js";
import { validateBody } from "../../middleware/validate.middleware.js";
import { applySchema, eraseSchema, policySchema } from "./privacy.schemas.js";
import { applyPrivacyCleanup, eraseContactData, exportContactData, getPrivacyPolicy, previewPrivacyCleanup, savePrivacyPolicy } from "./privacy.service.js";
import { runDueWorkspaceRetention } from "./privacy.service.js";
import { isInternalRealtimePublishAuthorized } from "../realtime/realtime.service.js";
import { AppError } from "../../shared/errors.js";

export const internalPrivacyRoutes = Router();
internalPrivacyRoutes.post("/run-due", asyncHandler(async (req, res) => {
  if (!isInternalRealtimePublishAuthorized(req.header("x-shilabs-realtime-secret"))) {
    throw new AppError(401, "AUTHENTICATION_ERROR", "Retention execution is not authorized");
  }
  res.set("Cache-Control", "no-store").json(await runDueWorkspaceRetention());
}));

export const privacyRoutes = Router();
privacyRoutes.use(requireAuth);
privacyRoutes.use((_request, response, next) => { response.set("Cache-Control", "no-store"); next(); });
const manager = requireRole([UserRole.ADMIN, UserRole.SALES_MANAGER]);
const admin = requireRole([UserRole.ADMIN]);
privacyRoutes.get("/policy", manager, asyncHandler(async (req, res) => { res.json(await getPrivacyPolicy(getRequiredUser(req))); }));
privacyRoutes.put("/policy", admin, validateBody(policySchema), asyncHandler(async (req, res) => { res.json(await savePrivacyPolicy(getRequiredUser(req), policySchema.parse(req.body))); }));
privacyRoutes.post("/cleanup/preview", admin, asyncHandler(async (req, res) => { res.json(await previewPrivacyCleanup(getRequiredUser(req))); }));
privacyRoutes.post("/cleanup/apply", admin, validateBody(applySchema), asyncHandler(async (req, res) => { res.json(await applyPrivacyCleanup(getRequiredUser(req), applySchema.parse(req.body).previewId)); }));
privacyRoutes.get("/contacts/:contactId/export", manager, asyncHandler(async (req, res) => {
  const result = await exportContactData(getRequiredUser(req), String(req.params.contactId));
  res.set("Content-Disposition", 'attachment; filename="contact-export.json"').json(result);
}));
privacyRoutes.post("/contacts/:contactId/erase", admin, validateBody(eraseSchema), asyncHandler(async (req, res) => { res.json(await eraseContactData(getRequiredUser(req), String(req.params.contactId))); }));
