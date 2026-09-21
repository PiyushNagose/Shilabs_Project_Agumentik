import type { ActivityDto } from "@shilabs/shared-types";
import { AppError } from "../../shared/errors.js";
import { toPublicUser } from "../auth/auth.service.js";
import { findLeadById } from "../leads/lead.repository.js";
import {
  listLeadActivities as listLeadActivityRecords,
  type ActivityRecord
} from "./activity.repository.js";

function toActivityDto(activity: ActivityRecord): ActivityDto {
  return {
    id: activity.id,
    leadId: activity.leadId,
    actorUserId: activity.actorUserId,
    type: activity.type,
    description: activity.description,
    createdAt: activity.createdAt.toISOString(),
    actorUser: activity.actorUser ? toPublicUser(activity.actorUser) : null
  };
}

export async function listLeadActivities(leadId: string): Promise<ActivityDto[]> {
  const lead = await findLeadById(leadId);
  if (!lead) {
    throw new AppError(404, "NOT_FOUND", "Lead not found");
  }

  return (await listLeadActivityRecords(leadId)).map(toActivityDto);
}
