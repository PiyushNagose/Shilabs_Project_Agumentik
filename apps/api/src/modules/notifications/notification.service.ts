import { Prisma, UserRole } from "@prisma/client";
import type { InternalNotificationDto, NegotiationHandoffDto } from "@shilabs/shared-types";
import { prisma } from "../../shared/prisma.js";
import { toPublicUser } from "../auth/auth.service.js";
import type { AuthenticatedUser } from "../auth/auth.types.js";
import { publishDomainEvent } from "../domain-events/domain-events.service.js";
import type { TransactionClient } from "../domain-events/domain-events.repository.js";
import type { ListNotificationsQuery } from "./notification.schemas.js";

type NegotiationHandoffRecord = Prisma.NegotiationHandoffGetPayload<{
  include: { assignedOwner: true };
}>;

type InternalNotificationRecord = Prisma.InternalNotificationGetPayload<{
  include: { negotiationHandoff: { include: { assignedOwner: true } } };
}>;

export function toNegotiationHandoffDto(
  handoff: NegotiationHandoffRecord
): NegotiationHandoffDto {
  return {
    id: handoff.id,
    leadId: handoff.leadId,
    conversationId: handoff.conversationId,
    replyProcessingRunId: handoff.replyProcessingRunId,
    assignedOwnerId: handoff.assignedOwnerId,
    status: handoff.status,
    summary: handoff.summary,
    failureCode: handoff.failureCode,
    failureMessage: handoff.failureMessage,
    createdAt: handoff.createdAt.toISOString(),
    updatedAt: handoff.updatedAt.toISOString(),
    assignedOwner: handoff.assignedOwner ? toPublicUser(handoff.assignedOwner) : null
  };
}

export function toInternalNotificationDto(
  notification: InternalNotificationRecord
): InternalNotificationDto {
  return {
    id: notification.id,
    type: notification.type,
    status: notification.status,
    severity: notification.severity,
    title: notification.title,
    body: notification.body,
    assignedToUserId: notification.assignedToUserId,
    leadId: notification.leadId,
    conversationId: notification.conversationId,
    negotiationHandoffId: notification.negotiationHandoffId,
    sourceEntityType: notification.sourceEntityType,
    sourceEntityId: notification.sourceEntityId,
    createdAt: notification.createdAt.toISOString(),
    updatedAt: notification.updatedAt.toISOString(),
    negotiationHandoff: notification.negotiationHandoff
      ? toNegotiationHandoffDto(notification.negotiationHandoff)
      : null
  };
}

export async function createNegotiationHandoffForReply(input: {
  client: TransactionClient;
  lead: { id: string; ownerId: string | null; company: { name: string } };
  conversationId: string;
  replyProcessingRunId: string;
  summary: string;
  inboundEmailId: string | null;
}): Promise<NegotiationHandoffDto> {
  const existing = await input.client.negotiationHandoff.findUnique({
    where: { idempotencyKey: `negotiation-handoff:reply:${input.replyProcessingRunId}` },
    include: { assignedOwner: true }
  });
  if (existing) return toNegotiationHandoffDto(existing);

  const hasOwner = Boolean(input.lead.ownerId);
  const handoff = await input.client.negotiationHandoff.create({
    data: {
      leadId: input.lead.id,
      conversationId: input.conversationId,
      replyProcessingRunId: input.replyProcessingRunId,
      assignedOwnerId: input.lead.ownerId,
      status: hasOwner ? "ACTIVE" : "ATTENTION_REQUIRED",
      summary: input.summary,
      failureCode: hasOwner ? null : "OWNER_NOT_ASSIGNED",
      failureMessage: hasOwner
        ? null
        : "Negotiation handoff could not be routed because the lead has no assigned owner",
      idempotencyKey: `negotiation-handoff:reply:${input.replyProcessingRunId}`
    },
    include: { assignedOwner: true }
  });

  await input.client.internalNotification.create({
    data: {
      type: "NEGOTIATION_HANDOFF",
      status: hasOwner ? "UNREAD" : "ATTENTION_REQUIRED",
      severity: hasOwner ? "WARNING" : "CRITICAL",
      title: hasOwner ? "Negotiation handoff required" : "Negotiation handoff needs owner",
      body: input.summary,
      assignedToUserId: input.lead.ownerId,
      leadId: input.lead.id,
      conversationId: input.conversationId,
      negotiationHandoffId: handoff.id,
      sourceEntityType: "NegotiationHandoff",
      sourceEntityId: handoff.id,
      idempotencyKey: `notification:negotiation-handoff:${handoff.id}`
    }
  });

  await input.client.activity.create({
    data: {
      leadId: input.lead.id,
      type: "NEGOTIATION_HANDOFF",
      description: hasOwner
        ? "Negotiation detected and routed to the assigned owner"
        : "Negotiation detected but the lead has no assigned owner"
    }
  });

  await input.client.auditEvent.create({
    data: {
      actorType: "SYSTEM",
      entityType: "NegotiationHandoff",
      entityId: handoff.id,
      action: hasOwner ? "NEGOTIATION_HANDOFF_CREATED" : "NEGOTIATION_HANDOFF_ATTENTION_REQUIRED",
      after: {
        leadId: input.lead.id,
        conversationId: input.conversationId,
        replyProcessingRunId: input.replyProcessingRunId,
        assignedOwnerId: input.lead.ownerId,
        status: handoff.status,
        inboundEmailId: input.inboundEmailId
      }
    }
  });

  await publishDomainEvent({
    client: input.client,
    eventType: "NEGOTIATION_HANDOFF_CREATED",
    aggregateType: "NegotiationHandoff",
    aggregateId: handoff.id,
    correlationId: input.inboundEmailId ?? input.replyProcessingRunId,
    idempotencyKey: `domain-event:negotiation-handoff:${handoff.id}`,
    priority: "HIGH",
    payload: {
      leadId: input.lead.id,
      conversationId: input.conversationId,
      replyProcessingRunId: input.replyProcessingRunId,
      assignedOwnerId: input.lead.ownerId,
      status: handoff.status
    }
  });

  return toNegotiationHandoffDto(handoff);
}

export async function listNotifications(
  actor: AuthenticatedUser,
  query: ListNotificationsQuery
): Promise<InternalNotificationDto[]> {
  const managerCanSeeAll = actor.role === UserRole.ADMIN || actor.role === UserRole.SALES_MANAGER;
  const notifications = await prisma.internalNotification.findMany({
    where: {
      leadId: query.leadId,
      status: query.status,
      OR: managerCanSeeAll
        ? undefined
        : [{ assignedToUserId: actor.id }, { assignedToUserId: null }]
    },
    include: { negotiationHandoff: { include: { assignedOwner: true } } },
    orderBy: [{ severity: "desc" }, { createdAt: "desc" }],
    take: query.limit
  });

  return notifications.map(toInternalNotificationDto);
}
