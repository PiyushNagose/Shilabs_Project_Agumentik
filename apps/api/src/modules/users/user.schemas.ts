import { z } from "zod";
import { USER_STATUSES, WORKSPACE_ROLES } from "@shilabs/shared-types";

export const userRoleSchema = z.enum(WORKSPACE_ROLES);
export const userStatusSchema = z.enum(USER_STATUSES);

export const createUserSchema = z.object({
  email: z
    .string()
    .trim()
    .pipe(z.email())
    .transform((value) => value.toLowerCase()),
  password: z.string().min(10),
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  role: userRoleSchema
});

export const updateUserSchema = z.object({
  firstName: z.string().trim().min(1).max(80).optional(),
  lastName: z.string().trim().min(1).max(80).optional(),
  role: userRoleSchema.optional()
});

export const updateUserStatusSchema = z.object({
  status: userStatusSchema
});

export const updateOwnProfileSchema = z.strictObject({
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80)
});

export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
export type UpdateUserStatusInput = z.infer<typeof updateUserStatusSchema>;
export type UpdateOwnProfileInput = z.infer<typeof updateOwnProfileSchema>;
