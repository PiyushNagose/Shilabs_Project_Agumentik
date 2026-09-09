import type { Request, Response } from "express";
import type { AuthResponse, PublicUser } from "@shilabs/shared-types";
import { AppError } from "../../shared/errors.js";
import { getRequiredUser } from "../../middleware/auth.middleware.js";
import { login, logout, toPublicUser } from "./auth.service.js";
import type { LoginInput } from "./auth.schemas.js";

export async function loginController(
  request: Request<Record<string, never>, AuthResponse, LoginInput>,
  response: Response<AuthResponse>
): Promise<void> {
  const result = await login(request.body);
  response.status(200).json(result);
}

export async function logoutController(request: Request, response: Response): Promise<void> {
  if (!request.accessToken) {
    throw new AppError(401, "AUTHENTICATION_ERROR", "Authentication required");
  }

  await logout(request.accessToken);
  response.status(204).send();
}

export function meController(request: Request, response: Response<PublicUser>): void {
  response.status(200).json(toPublicUser(getRequiredUser(request)));
}
