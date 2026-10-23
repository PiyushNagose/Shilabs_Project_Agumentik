import type { Request, Response } from "express";
import type { PublicUser } from "@shilabs/shared-types";
import { getRequiredUser } from "../../middleware/auth.middleware.js";
import type {
  CreateUserInput,
  UpdateOwnProfileInput,
  UpdateUserInput,
  UpdateUserStatusInput
} from "./user.schemas.js";
import {
  createUser,
  getUser,
  listUsers,
  updateOwnProfile,
  updateUser,
  updateUserStatus
} from "./user.service.js";

export async function listUsersController(
  request: Request,
  response: Response<PublicUser[]>
): Promise<void> {
  response.status(200).json(await listUsers(getRequiredUser(request)));
}

export async function updateOwnProfileController(
  request: Request<Record<string, never>, PublicUser, UpdateOwnProfileInput>,
  response: Response<PublicUser>
): Promise<void> {
  response.status(200).json(await updateOwnProfile(getRequiredUser(request), request.body));
}

export async function getUserController(
  request: Request<{ id: string }>,
  response: Response<PublicUser>
): Promise<void> {
  response.status(200).json(await getUser(getRequiredUser(request), request.params.id));
}

export async function createUserController(
  request: Request<Record<string, never>, PublicUser, CreateUserInput>,
  response: Response<PublicUser>
): Promise<void> {
  response.status(201).json(await createUser(getRequiredUser(request), request.body));
}

export async function updateUserController(
  request: Request<{ id: string }, PublicUser, UpdateUserInput>,
  response: Response<PublicUser>
): Promise<void> {
  response
    .status(200)
    .json(await updateUser(getRequiredUser(request), request.params.id, request.body));
}

export async function updateUserStatusController(
  request: Request<{ id: string }, PublicUser, UpdateUserStatusInput>,
  response: Response<PublicUser>
): Promise<void> {
  response
    .status(200)
    .json(await updateUserStatus(getRequiredUser(request), request.params.id, request.body));
}
