import type { ActivityDto } from "@shilabs/shared-types";
import { AppError } from "../../shared/errors.js";
import { toPublicUser } from "../auth/auth.service.js";
import type { AuthenticatedUser } from "../auth/auth.types.js";
import { findLeadById } from "../leads/lead.repository.js";
import { assertCanAccessLead } from "../leads/lead.permissions.js";
import {
  listLeadActivities as listLeadActivityRecords,
  type ActivityRecord
} from "./activity.repository.js";

function toActivityDto(activity: ActivityRecord): ActivityDto {
  return {
    id: activity.id,
    leadId: activity.leadId,
    entityType: activity.entityType,
    entityId: activity.entityId ?? activity.leadId,
    actorType: activity.actorType,
    actorUserId: activity.actorUserId,
    actorAgentId: activity.actorAgentId,
    sourceType: activity.sourceType,
    sourceId: activity.sourceId,
    type: activity.type,
    title: activity.title ?? activity.type.replaceAll("_", " ").toLowerCase(),
    summary: activity.description,
    description: activity.description,
    metadata: activity.metadata,
    occurredAt: activity.occurredAt.toISOString(),
    correlationId: activity.correlationId,
    visibility: activity.visibility,
    createdAt: activity.createdAt.toISOString(),
    actorUser: activity.actorUser ? toPublicUser(activity.actorUser) : null
  };
}

export async function listLeadActivities(
  actor: AuthenticatedUser,
  leadId: string
): Promise<ActivityDto[]> {
  const lead = await findLeadById(leadId);
  if (!lead) {
    throw new AppError(404, "NOT_FOUND", "Lead not found");
  }
  assertCanAccessLead(actor, lead);
  if (!actor.activeWorkspaceId)
    throw new AppError(403, "AUTHORIZATION_ERROR", "Workspace required");

  return (await listLeadActivityRecords({ leadId, workspaceId: actor.activeWorkspaceId })).map(
    toActivityDto
  );
}
