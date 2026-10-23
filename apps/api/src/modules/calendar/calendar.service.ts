import { UserStatus } from "@prisma/client";
import { getCalendarConfig } from "@shilabs/shared-config";
import type { CalendarAvailabilityResultDto, CalendarHealthDto } from "@shilabs/shared-types";
import { AppError } from "../../shared/errors.js";
import { prisma } from "../../shared/prisma.js";
import type { AuthenticatedUser } from "../auth/auth.types.js";
import { isWorkspaceManager } from "../authorization/workspace-permissions.js";
import { createCalendarProvider } from "./calendar.provider.js";
import type { CalendarAvailabilityInput } from "./calendar.schemas.js";
import { resolveWorkspaceCalendarConfig } from "./calendar-oauth.service.js";

export { resolveWorkspaceCalendarConfig } from "./calendar-oauth.service.js";

export async function getCalendarHealth(workspaceId?: string): Promise<CalendarHealthDto> {
  const provider = createCalendarProvider(workspaceId ? await resolveWorkspaceCalendarConfig(workspaceId) : getCalendarConfig());
  return provider.getHealth();
}

function canRequestOwnerAvailability(actor: AuthenticatedUser, ownerUserId: string): boolean {
  if (isWorkspaceManager(actor)) {
    return true;
  }

  return actor.id === ownerUserId;
}

export async function getCalendarAvailability(
  actor: AuthenticatedUser,
  input: CalendarAvailabilityInput
): Promise<CalendarAvailabilityResultDto> {
  if (!canRequestOwnerAvailability(actor, input.ownerUserId)) {
    throw new AppError(403, "AUTHORIZATION_ERROR", "Cannot access another user's availability");
  }

  if (!actor.activeWorkspaceId) throw new AppError(403, "AUTHORIZATION_ERROR", "Active workspace required");
  const membership = await prisma.workspaceMember.findFirst({
    where: { workspaceId: actor.activeWorkspaceId, userId: input.ownerUserId, status: "ACTIVE", workspace: { status: "ACTIVE" } },
    select: { id: true }
  });
  if (!membership) throw new AppError(404, "NOT_FOUND", "Availability owner was not found");

  const owner = await prisma.user.findUnique({
    where: { id: input.ownerUserId },
    select: { id: true, status: true }
  });

  if (owner?.status !== UserStatus.ACTIVE) {
    throw new AppError(404, "NOT_FOUND", "Availability owner was not found");
  }

  const config = await resolveWorkspaceCalendarConfig(actor.activeWorkspaceId);
  const provider = createCalendarProvider(config);
  return provider.getAvailability({
    ownerUserId: input.ownerUserId,
    timeZone: input.timeZone,
    windowStart: input.windowStart,
    windowEnd: input.windowEnd,
    slotMinutes: input.slotMinutes ?? config.slotMinutes
  });
}
