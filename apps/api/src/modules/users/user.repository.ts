import type { Prisma, User } from "@prisma/client";
import { prisma } from "../../shared/prisma.js";

export type UserRecord = Pick<
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

export async function listUsers(): Promise<UserRecord[]> {
  return prisma.user.findMany({
    orderBy: [{ createdAt: "asc" }, { email: "asc" }]
  });
}

export async function findUserById(id: string): Promise<UserRecord | null> {
  return prisma.user.findUnique({
    where: { id }
  });
}

export async function createUser(data: Prisma.UserCreateInput): Promise<UserRecord> {
  return prisma.user.create({
    data
  });
}

export async function updateUser(id: string, data: Prisma.UserUpdateInput): Promise<UserRecord> {
  return prisma.user.update({
    where: { id },
    data
  });
}
