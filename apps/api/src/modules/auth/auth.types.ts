import type { UserRole, UserStatus } from "@prisma/client";

export interface AuthenticatedUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  status: UserStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface AccessTokenClaims {
  sub: string;
  sessionId: string;
}
