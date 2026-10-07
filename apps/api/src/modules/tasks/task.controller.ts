import type { Request, Response } from "express";
import type { TaskDto } from "@shilabs/shared-types";
import { getRequiredUser } from "../../middleware/auth.middleware.js";
import type { CreateTaskInput, ListTasksQuery, UpdateTaskInput } from "./task.schemas.js";
import { completeTask, createTask, getTask, listTasks, updateTask } from "./task.service.js";

export async function listTasksController(
  request: Request<Record<string, never>, TaskDto[], Record<string, never>, ListTasksQuery>,
  response: Response<TaskDto[]>
): Promise<void> {
  response.status(200).json(await listTasks(getRequiredUser(request), request.query));
}
export async function getTaskController(
  request: Request<{ id: string }>,
  response: Response<TaskDto>
): Promise<void> {
  response.status(200).json(await getTask(getRequiredUser(request), request.params.id));
}
export async function createTaskController(
  request: Request<Record<string, never>, TaskDto, CreateTaskInput>,
  response: Response<TaskDto>
): Promise<void> {
  response.status(201).json(await createTask(getRequiredUser(request), request.body));
}
export async function updateTaskController(
  request: Request<{ id: string }, TaskDto, UpdateTaskInput>,
  response: Response<TaskDto>
): Promise<void> {
  response
    .status(200)
    .json(await updateTask(getRequiredUser(request), request.params.id, request.body));
}
export async function completeTaskController(
  request: Request<{ id: string }>,
  response: Response<TaskDto>
): Promise<void> {
  response.status(200).json(await completeTask(getRequiredUser(request), request.params.id));
}
