import { Router } from "express";
import { asyncHandler } from "../../middleware/async-handler.js";
import { requireAuth } from "../../middleware/auth.middleware.js";
import { validateBody } from "../../middleware/validate.middleware.js";
import {
  createCompanyController,
  getCompanyController,
  listCompaniesController,
  updateCompanyController
} from "./company.controller.js";
import { createCompanySchema, updateCompanySchema } from "./company.schemas.js";

export const companyRoutes = Router();

companyRoutes.use(requireAuth);
companyRoutes.get("/", asyncHandler(listCompaniesController));
companyRoutes.post("/", validateBody(createCompanySchema), asyncHandler(createCompanyController));
companyRoutes.get("/:id", asyncHandler(getCompanyController));
companyRoutes.patch(
  "/:id",
  validateBody(updateCompanySchema),
  asyncHandler(updateCompanyController)
);
