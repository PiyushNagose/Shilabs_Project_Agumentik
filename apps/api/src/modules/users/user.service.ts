import { Prisma, UserRole } from "@prisma/client";
import type { PublicUser } from "@shilabs/shared-types";
import { AppError } from "../../shared/errors.js";
import { hashPassword, toPublicUser } from "../auth/auth.service.js";
import type { AuthenticatedUser } from "../auth/auth.types.js";
import type { CreateUserInput, UpdateUserInput, UpdateUserStatusInput } from "./user.schemas.js";
import {
  createUser as createUserRecord,
  findUserById,
  listUsers as listUserRecords,
  updateUser as updateUserRecord,
  type UserRecord
} from "./user.repository.js";

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function requireUser(user: UserRecord | null): UserRecord {
  if (!user) {
    throw new AppError(404, "NOT_FOUND", "User not found");
  }

  return user;
}

function ensureManagerCanReadUser(actor: AuthenticatedUser, targetUserId: string): void {
  if (
    actor.id === targetUserId ||
    actor.role === UserRole.ADMIN ||
    actor.role === UserRole.SALES_MANAGER
  ) {
    return;
  }

  throw new AppError(403, "AUTHORIZATION_ERROR", "Insufficient role permissions");
}

export async function listUsers(): Promise<PublicUser[]> {
  const users = await listUserRecords();
  return users.map(toPublicUser);
}

export async function getUser(actor: AuthenticatedUser, userId: string): Promise<PublicUser> {
  ensureManagerCanReadUser(actor, userId);
  return toPublicUser(requireUser(await findUserById(userId)));
}

export async function createUser(input: CreateUserInput): Promise<PublicUser> {
  try {
    const user = await createUserRecord({
      email: input.email,
      passwordHash: await hashPassword(input.password),
      firstName: input.firstName,
      lastName: input.lastName,
      role: input.role
    });

    return toPublicUser(user);
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw new AppError(409, "CONFLICT", "A user with this email already exists");
    }

    throw error;
  }
}

export async function updateUser(userId: string, input: UpdateUserInput): Promise<PublicUser> {
  try {
    return toPublicUser(
      await updateUserRecord(userId, {
        firstName: input.firstName,
        lastName: input.lastName,
        role: input.role
      })
    );
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      throw new AppError(404, "NOT_FOUND", "User not found");
    }

    throw error;
  }
}

export async function updateUserStatus(
  userId: string,
  input: UpdateUserStatusInput
): Promise<PublicUser> {
  try {
    return toPublicUser(
      await updateUserRecord(userId, {
        status: input.status
      })
    );
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      throw new AppError(404, "NOT_FOUND", "User not found");
    }

    throw error;
  }
}
