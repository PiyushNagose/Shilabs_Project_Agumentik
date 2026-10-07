import type { AuthenticatedUser } from "../modules/auth/auth.types.js";
import type { WorkspaceContext } from "../modules/workspaces/workspace.service.js";

declare module "express-serve-static-core" {
  interface Request {
    user?: AuthenticatedUser;
    accessToken?: string;
    validatedQuery?: unknown;
    workspace?: WorkspaceContext;
  }
}
