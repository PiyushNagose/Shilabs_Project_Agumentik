import { Router } from "express";
import { asyncHandler } from "../../middleware/async-handler.js";
import { requireAuth } from "../../middleware/auth.middleware.js";
import { validateBody } from "../../middleware/validate.middleware.js";
import {
  createContactController,
  getContactController,
  listContactsController,
  updateContactController
} from "./contact.controller.js";
import { createContactSchema, updateContactSchema } from "./contact.schemas.js";

export const contactRoutes = Router();

contactRoutes.use(requireAuth);
contactRoutes.get("/", asyncHandler(listContactsController));
contactRoutes.post("/", validateBody(createContactSchema), asyncHandler(createContactController));
contactRoutes.get("/:id", asyncHandler(getContactController));
contactRoutes.patch(
  "/:id",
  validateBody(updateContactSchema),
  asyncHandler(updateContactController)
);
