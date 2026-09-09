import type { User } from "@prisma/client";
import { UserStatus } from "@prisma/client";
import { prisma } from "../../shared/prisma.js";

export type AuthUserRecord = Pick<
  User,
  | "id"
  | "email"
  | "passwordHash"
  | "firstName"
  | "lastName"
  | "role"
  | "status"
  | "createdAt"
  | "updatedAt"
>;

export async function findUserByEmail(email: string): Promise<AuthUserRecord | null> {
  return prisma.user.findUnique({
    where: { email }
  });
}

export async function findActiveUserById(userId: string): Promise<AuthUserRecord | null> {
  return prisma.user.findFirst({
    where: {
      id: userId,
      status: UserStatus.ACTIVE
    }
  });
}

export async function createAuthSession(input: {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
}) {
  return prisma.authSession.create({
    data: input
  });
}

export async function findActiveSession(input: {
  sessionId: string;
  tokenHash: string;
  now: Date;
}) {
  return prisma.authSession.findFirst({
    where: {
      id: input.sessionId,
      tokenHash: input.tokenHash,
      revokedAt: null,
      expiresAt: {
        gt: input.now
      }
    }
  });
}

export async function revokeSession(input: {
  sessionId: string;
  tokenHash: string;
  revokedAt: Date;
}) {
  await prisma.authSession.updateMany({
    where: {
      id: input.sessionId,
      tokenHash: input.tokenHash,
      revokedAt: null
    },
    data: {
      revokedAt: input.revokedAt
    }
  });
}
