import { createHash, randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { jwtVerify, SignJWT } from "jose";
import { getAuthConfig } from "@shilabs/shared-config";
import type { AuthResponse, PublicUser } from "@shilabs/shared-types";
import { UserStatus } from "@prisma/client";
import { AppError } from "../../shared/errors.js";
import type { LoginInput } from "./auth.schemas.js";
import type { AccessTokenClaims, AuthenticatedUser } from "./auth.types.js";
import {
  createAuthSession,
  findActiveSession,
  findActiveUserById,
  findUserByEmail,
  type AuthUserRecord,
  revokeSession
} from "./auth.repository.js";

const encoder = new TextEncoder();

export function toPublicUser(user: AuthUserRecord | AuthenticatedUser): PublicUser {
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    role: user.role,
    status: user.status,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString()
  };
}

export async function hashPassword(password: string): Promise<string> {
  const config = getAuthConfig();
  return bcrypt.hash(password, config.bcryptSaltRounds);
}

export async function verifyPassword(password: string, passwordHash: string): Promise<boolean> {
  return bcrypt.compare(password, passwordHash);
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

async function signAccessToken(input: {
  userId: string;
  sessionId: string;
  expiresAt: Date;
}): Promise<string> {
  const config = getAuthConfig();
  return new SignJWT({ sessionId: input.sessionId })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(input.userId)
    .setIssuedAt()
    .setExpirationTime(input.expiresAt)
    .sign(encoder.encode(config.jwtSecret));
}

export async function login(input: LoginInput): Promise<AuthResponse> {
  const user = await findUserByEmail(input.email);

  if (!user) {
    throw new AppError(401, "AUTHENTICATION_ERROR", "Invalid email or password");
  }

  if (user.status !== UserStatus.ACTIVE) {
    throw new AppError(403, "AUTHORIZATION_ERROR", "User account is inactive");
  }

  const passwordValid = await verifyPassword(input.password, user.passwordHash);
  if (!passwordValid) {
    throw new AppError(401, "AUTHENTICATION_ERROR", "Invalid email or password");
  }

  const config = getAuthConfig();
  const expiresAt = new Date(Date.now() + config.accessTokenTtlSeconds * 1000);
  const sessionId = randomUUID();
  const accessToken = await signAccessToken({
    userId: user.id,
    sessionId,
    expiresAt
  });
  await createAuthSession({
    id: sessionId,
    userId: user.id,
    tokenHash: hashToken(accessToken),
    expiresAt
  });

  return {
    accessToken,
    user: toPublicUser(user)
  };
}

export async function verifyAccessToken(accessToken: string): Promise<AuthenticatedUser> {
  const config = getAuthConfig();
  const result = await jwtVerify(accessToken, encoder.encode(config.jwtSecret)).catch(() => {
    throw new AppError(401, "AUTHENTICATION_ERROR", "Invalid access token");
  });
  const payload = result.payload as Partial<AccessTokenClaims>;

  if (!payload.sub || !payload.sessionId) {
    throw new AppError(401, "AUTHENTICATION_ERROR", "Invalid access token");
  }

  const session = await findActiveSession({
    sessionId: payload.sessionId,
    tokenHash: hashToken(accessToken),
    now: new Date()
  });

  if (!session) {
    throw new AppError(401, "AUTHENTICATION_ERROR", "Invalid access token");
  }

  const user = await findActiveUserById(payload.sub);
  if (!user) {
    throw new AppError(401, "AUTHENTICATION_ERROR", "Invalid access token");
  }

  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    role: user.role,
    status: user.status,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt
  };
}

export async function logout(accessToken: string): Promise<void> {
  const config = getAuthConfig();
  const result = await jwtVerify(accessToken, encoder.encode(config.jwtSecret)).catch(() => {
    throw new AppError(401, "AUTHENTICATION_ERROR", "Invalid access token");
  });
  const payload = result.payload as Partial<AccessTokenClaims>;

  if (!payload.sessionId) {
    throw new AppError(401, "AUTHENTICATION_ERROR", "Invalid access token");
  }

  await revokeSession({
    sessionId: payload.sessionId,
    tokenHash: hashToken(accessToken),
    revokedAt: new Date()
  });
}
