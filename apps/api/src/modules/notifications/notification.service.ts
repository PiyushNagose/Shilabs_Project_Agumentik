import { Prisma, UserRole } from "@prisma/client";
import type { InternalNotificationDto, NegotiationHandoffDto } from "@shilabs/shared-types";
import { AppError } from "../../shared/errors.js";
import { prisma } from "../../shared/prisma.js";
import { toPublicUser } from "../auth/auth.service.js";
import type { AuthenticatedUser } from "../auth/auth.types.js";
import { publishDomainEvent } from "../domain-events/domain-events.service.js";
import type { TransactionClient } from "../domain-events/domain-events.repository.js";
import type {
  AcknowledgeNotificationInput,
  EscalateNotificationInput,
  ListNotificationsQuery
} from "./notification.schemas.js";

type NegotiationHandoffRecord = Prisma.NegotiationHandoffGetPayload<{
  include: { assignedOwner: true };
}>;

type InternalNotificationRecord = Prisma.InternalNotificationGetPayload<{
  include: { negotiationHandoff: { include: { assignedOwner: true } } };
}>;

export function toNegotiationHandoffDto(handoff: NegotiationHandoffRecord): NegotiationHandoffDto {
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
    escalationStatus: notification.escalationStatus,
    title: notification.title,
    body: notification.body,
    assignedToUserId: notification.assignedToUserId,
    readByUserId: notification.readByUserId,
    acknowledgedByUserId: notification.acknowledgedByUserId,
    escalatedByUserId: notification.escalatedByUserId,
    leadId: notification.leadId,
    conversationId: notification.conversationId,
    negotiationHandoffId: notification.negotiationHandoffId,
    meetingRequestId: notification.meetingRequestId,
    sourceEntityType: notification.sourceEntityType,
    sourceEntityId: notification.sourceEntityId,
    readAt: notification.readAt?.toISOString() ?? null,
    acknowledgedAt: notification.acknowledgedAt?.toISOString() ?? null,
    escalatedAt: notification.escalatedAt?.toISOString() ?? null,
    escalationDueAt: notification.escalationDueAt?.toISOString() ?? null,
    escalationReason: notification.escalationReason,
    escalationEvidence: notification.escalationEvidence,
    createdAt: notification.createdAt.toISOString(),
    updatedAt: notification.updatedAt.toISOString(),
    negotiationHandoff: notification.negotiationHandoff
      ? toNegotiationHandoffDto(notification.negotiationHandoff)
      : null
  };
}

function canSeeAll(actor: AuthenticatedUser): boolean {
  return actor.role === UserRole.ADMIN || actor.role === UserRole.SALES_MANAGER;
}

function canAccessNotification(
  actor: AuthenticatedUser,
  notification: { assignedToUserId: string | null }
): boolean {
  return canSeeAll(actor) || notification.assignedToUserId === actor.id || !notification.assignedToUserId;
}

async function getVisibleNotificationOrThrow(
  actor: AuthenticatedUser,
  notificationId: string
): Promise<InternalNotificationRecord> {
  const notification = await prisma.internalNotification.findUnique({
    where: { id: notificationId },
    include: { negotiationHandoff: { include: { assignedOwner: true } } }
  });
  if (!notification) throw new AppError(404, "NOT_FOUND", "Notification not found");
  if (!canAccessNotification(actor, notification)) {
    throw new AppError(403, "AUTHORIZATION_ERROR", "Cannot access this notification");
  }
  return notification;
}

function statusAfterRead(current: InternalNotificationRecord["status"]): InternalNotificationRecord["status"] {
  if (current === "UNREAD") return "READ";
  return current;
}

async function publishNotificationLifecycleEvent(input: {
  client: TransactionClient;
  actor: AuthenticatedUser;
  notification: { id: string; status: string; sourceEntityType: string; sourceEntityId: string };
  action: string;
  payload?: Prisma.InputJsonObject;
}): Promise<void> {
  await input.client.auditEvent.create({
    data: {
      actorType: "USER",
      actorId: input.actor.id,
      entityType: "InternalNotification",
      entityId: input.notification.id,
      action: input.action,
      after: {
        status: input.notification.status,
        sourceEntityType: input.notification.sourceEntityType,
        sourceEntityId: input.notification.sourceEntityId,
        ...(input.payload ?? {})
      }
    }
  });
  await publishDomainEvent({
    client: input.client,
    eventType: input.action,
    aggregateType: "InternalNotification",
    aggregateId: input.notification.id,
    correlationId: input.notification.sourceEntityId,
    idempotencyKey: `domain-event:notification:${input.notification.id}:${input.action.toLowerCase()}`,
    maxAttempts: 1,
    payload: {
      notificationId: input.notification.id,
      sourceEntityType: input.notification.sourceEntityType,
      sourceEntityId: input.notification.sourceEntityId,
      status: input.notification.status,
      ...(input.payload ?? {})
    }
  });
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
  const managerCanSeeAll = canSeeAll(actor);
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

export async function markNotificationRead(
  actor: AuthenticatedUser,
  notificationId: string
): Promise<InternalNotificationDto> {
  const existing = await getVisibleNotificationOrThrow(actor, notificationId);
  if (existing.readAt && existing.status !== "UNREAD") return toInternalNotificationDto(existing);

  const updated = await prisma.$transaction(async (tx) => {
    const notification = await tx.internalNotification.update({
      where: { id: notificationId },
      data: {
        status: statusAfterRead(existing.status),
        readAt: existing.readAt ?? new Date(),
        readByUserId: existing.readByUserId ?? actor.id
      },
      include: { negotiationHandoff: { include: { assignedOwner: true } } }
    });
    await publishNotificationLifecycleEvent({
      client: tx,
      actor,
      notification,
      action: "NOTIFICATION_READ"
    });
    return notification;
  });

  return toInternalNotificationDto(updated);
}

export async function acknowledgeNotification(
  actor: AuthenticatedUser,
  notificationId: string,
  input: AcknowledgeNotificationInput
): Promise<InternalNotificationDto> {
  const existing = await getVisibleNotificationOrThrow(actor, notificationId);
  if (existing.status === "ACKNOWLEDGED") return toInternalNotificationDto(existing);

  const updated = await prisma.$transaction(async (tx) => {
    const notification = await tx.internalNotification.update({
      where: { id: notificationId },
      data: {
        status: "ACKNOWLEDGED",
        acknowledgedAt: existing.acknowledgedAt ?? new Date(),
        acknowledgedByUserId: existing.acknowledgedByUserId ?? actor.id,
        readAt: existing.readAt ?? new Date(),
        readByUserId: existing.readByUserId ?? actor.id
      },
      include: { negotiationHandoff: { include: { assignedOwner: true } } }
    });
    await publishNotificationLifecycleEvent({
      client: tx,
      actor,
      notification,
      action: "NOTIFICATION_ACKNOWLEDGED",
      payload: { note: input.note ?? null }
    });
    return notification;
  });

  return toInternalNotificationDto(updated);
}

export async function escalateNotification(
  actor: AuthenticatedUser,
  notificationId: string,
  input: EscalateNotificationInput
): Promise<InternalNotificationDto> {
  const existing = await getVisibleNotificationOrThrow(actor, notificationId);
  if (existing.status === "ESCALATED" && existing.escalationStatus === "ESCALATED") {
    return toInternalNotificationDto(existing);
  }
  if (!canSeeAll(actor)) {
    throw new AppError(403, "AUTHORIZATION_ERROR", "Only managers can escalate notifications");
  }

  const dueAt = input.escalationDueAt ? new Date(input.escalationDueAt) : null;
  const updated = await prisma.$transaction(async (tx) => {
    const notification = await tx.internalNotification.update({
      where: { id: notificationId },
      data: {
        status: "ESCALATED",
        severity: "CRITICAL",
        escalationStatus: "ESCALATED",
        escalatedAt: existing.escalatedAt ?? new Date(),
        escalatedByUserId: existing.escalatedByUserId ?? actor.id,
        escalationDueAt: dueAt,
        escalationReason: input.reason,
        escalationEvidence: {
          reason: input.reason,
          escalationDueAt: dueAt?.toISOString() ?? null,
          channels: "UNRESOLVED_CLIENT_DECISION"
        }
      },
      include: { negotiationHandoff: { include: { assignedOwner: true } } }
    });
    await publishNotificationLifecycleEvent({
      client: tx,
      actor,
      notification,
      action: "NOTIFICATION_ESCALATED",
      payload: {
        reason: input.reason,
        escalationDueAt: dueAt?.toISOString() ?? null,
        externalChannels: "NOT_IMPLEMENTED"
      }
    });
    return notification;
  });

  return toInternalNotificationDto(updated);
}
