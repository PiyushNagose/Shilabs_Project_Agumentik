import type { UserRole, UserStatus, WorkspaceRole } from "@prisma/client";

export interface AuthenticatedUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  status: UserStatus;
  createdAt: Date;
  updatedAt: Date;
  activeWorkspaceId?: string;
  activeWorkspaceRole?: WorkspaceRole;
}

export interface AccessTokenClaims {
  sub: string;
  sessionId: string;
}
