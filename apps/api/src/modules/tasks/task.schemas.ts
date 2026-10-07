import { z } from "zod";

const optionalDateTime = z.iso.datetime().nullable().optional();
const optionalId = z.string().trim().min(1).nullable().optional();

export const listTasksQuerySchema = z.object({
  leadId: z.string().trim().min(1).optional(),
  status: z.enum(["OPEN", "IN_PROGRESS", "COMPLETED", "CANCELED"]).optional()
});

export const createTaskSchema = z.object({
  leadId: z.string().trim().min(1),
  title: z.string().trim().min(1).max(240),
  description: z.string().trim().max(4000).nullable().optional(),
  priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).optional(),
  dueAt: optionalDateTime,
  reminderAt: optionalDateTime,
  assignedToUserId: optionalId,
  isNextAction: z.boolean().optional()
});

export const updateTaskSchema = z
  .object({
    title: z.string().trim().min(1).max(240).optional(),
    description: z.string().trim().max(4000).nullable().optional(),
    status: z.enum(["OPEN", "IN_PROGRESS", "CANCELED"]).optional(),
    priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).optional(),
    dueAt: optionalDateTime,
    reminderAt: optionalDateTime,
    assignedToUserId: optionalId,
    isNextAction: z.boolean().optional()
  })
  .refine((value) => Object.keys(value).length > 0, "At least one field is required");

export type ListTasksQuery = z.infer<typeof listTasksQuerySchema>;
export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;
