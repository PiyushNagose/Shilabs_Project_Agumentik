import { UserRole, UserStatus } from "@prisma/client";
import { getCalendarConfig } from "@shilabs/shared-config";
import type { CalendarAvailabilityResultDto, CalendarHealthDto } from "@shilabs/shared-types";
import { AppError } from "../../shared/errors.js";
import { prisma } from "../../shared/prisma.js";
import type { AuthenticatedUser } from "../auth/auth.types.js";
import { createCalendarProvider } from "./calendar.provider.js";
import type { CalendarAvailabilityInput } from "./calendar.schemas.js";

export async function getCalendarHealth(): Promise<CalendarHealthDto> {
  const provider = createCalendarProvider(getCalendarConfig());
  return provider.getHealth();
}

function canRequestOwnerAvailability(actor: AuthenticatedUser, ownerUserId: string): boolean {
  if (actor.role === UserRole.ADMIN || actor.role === UserRole.SALES_MANAGER) {
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

  const owner = await prisma.user.findUnique({
    where: { id: input.ownerUserId },
    select: { id: true, status: true }
  });

  if (owner?.status !== UserStatus.ACTIVE) {
    throw new AppError(404, "NOT_FOUND", "Availability owner was not found");
  }

  const config = getCalendarConfig();
  const provider = createCalendarProvider(config);
  return provider.getAvailability({
    ownerUserId: input.ownerUserId,
    timeZone: input.timeZone,
    windowStart: input.windowStart,
    windowEnd: input.windowEnd,
    slotMinutes: input.slotMinutes ?? config.slotMinutes
  });
}
