import type { NextFunction, Request, Response } from "express";
import { getRequiredUser } from "./auth.middleware.js";
import { resolveWorkspaceContext } from "../modules/workspaces/workspace.service.js";

export async function requireWorkspaceContext(
  request: Request,
  _response: Response,
  next: NextFunction
): Promise<void> {
  try {
    const user = getRequiredUser(request);
    const context = await resolveWorkspaceContext(user.id, request.header("x-workspace-id"));
    request.workspace = context;
    request.user = { ...user, activeWorkspaceId: context.workspaceId };
    next();
  } catch (error) {
    next(error);
  }
}
