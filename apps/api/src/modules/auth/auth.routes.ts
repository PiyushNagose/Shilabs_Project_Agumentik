import { Router } from "express";
import rateLimit from "express-rate-limit";
import { asyncHandler } from "../../middleware/async-handler.js";
import { requireAuth } from "../../middleware/auth.middleware.js";
import { validateBody } from "../../middleware/validate.middleware.js";
import { loginController, logoutController, meController } from "./auth.controller.js";
import { loginSchema } from "./auth.schemas.js";

export const authRoutes = Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false
});

authRoutes.post("/login", loginLimiter, validateBody(loginSchema), asyncHandler(loginController));
authRoutes.post("/logout", requireAuth, asyncHandler(logoutController));
authRoutes.get("/me", requireAuth, meController);
