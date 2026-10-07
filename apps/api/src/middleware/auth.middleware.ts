import type { NextFunction, Request, Response } from "express";
import type { UserRole } from "@prisma/client";
import { AppError } from "../shared/errors.js";
import { verifyAccessToken } from "../modules/auth/auth.service.js";
import type { AuthenticatedUser } from "../modules/auth/auth.types.js";
import { resolveWorkspaceContext } from "../modules/workspaces/workspace.service.js";

function getBearerToken(request: Request): string {
  const authorization = request.header("authorization");
  if (!authorization?.startsWith("Bearer ")) {
    throw new AppError(401, "AUTHENTICATION_ERROR", "Authentication required");
  }

  return authorization.slice("Bearer ".length).trim();
}

export async function requireAuth(
  request: Request,
  _response: Response,
  next: NextFunction
): Promise<void> {
  try {
    const token = getBearerToken(request);
    const user = await verifyAccessToken(token);
    const workspace = await resolveWorkspaceContext(user.id, request.header("x-workspace-id"));
    request.workspace = workspace;
    request.user = { ...user, activeWorkspaceId: workspace.workspaceId };
    request.accessToken = token;
    next();
  } catch (error) {
    next(error);
  }
}

export function getRequiredUser(request: Request): AuthenticatedUser {
  if (!request.user) {
    throw new AppError(401, "AUTHENTICATION_ERROR", "Authentication required");
  }

  return request.user;
}

export function requireRole(allowedRoles: readonly UserRole[]) {
  return (request: Request, _response: Response, next: NextFunction): void => {
    const user = getRequiredUser(request);
    if (!allowedRoles.includes(user.role)) {
      next(new AppError(403, "AUTHORIZATION_ERROR", "Insufficient role permissions"));
      return;
    }

    next();
  };
}

export function requireSelfOrRole(allowedRoles: readonly UserRole[]) {
  return (request: Request, _response: Response, next: NextFunction): void => {
    const user = getRequiredUser(request);
    if (request.params.id === user.id || allowedRoles.includes(user.role)) {
      next();
      return;
    }

    next(new AppError(403, "AUTHORIZATION_ERROR", "Insufficient role permissions"));
  };
}
