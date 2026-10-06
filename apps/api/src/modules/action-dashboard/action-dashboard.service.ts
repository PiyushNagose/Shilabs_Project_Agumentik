import { Prisma, UserRole } from "@prisma/client";
import type {
  SalesActionDashboardDto,
  SalesActionDashboardItemDto,
  SalesActionDashboardItemSeverity
} from "@shilabs/shared-types";
import { prisma } from "../../shared/prisma.js";
import type { AuthenticatedUser } from "../auth/auth.types.js";
import { toHumanTakeoverDto } from "../conversations/conversation.service.js";
import { toLeadDto } from "../leads/lead.service.js";
import {
  toInternalNotificationDto,
  toNegotiationHandoffDto
} from "../notifications/notification.service.js";
import { proposalInclude } from "../proposals/proposal.repository.js";

const DASHBOARD_LIMIT = 25;

function canSeeAll(actor: AuthenticatedUser): boolean {
  return actor.role === UserRole.ADMIN || actor.role === UserRole.SALES_MANAGER;
}

function leadVisibilityWhere(actor: AuthenticatedUser): Prisma.LeadWhereInput {
  if (canSeeAll(actor)) {
    return {};
  }

  return {
    OR: [{ ownerId: actor.id }, { ownerId: null }]
  };
}

function notificationVisibilityWhere(
  actor: AuthenticatedUser
): Prisma.InternalNotificationWhereInput {
  if (canSeeAll(actor)) {
    return {};
  }

  return {
    OR: [{ assignedToUserId: actor.id }, { assignedToUserId: null }]
  };
}

function itemTime(item: SalesActionDashboardItemDto): number {
  return new Date(item.occurredAt).getTime();
}

function severityRank(severity: SalesActionDashboardItemSeverity): number {
  if (severity === "CRITICAL") return 3;
  if (severity === "WARNING") return 2;
  return 1;
}

function sortItems(items: SalesActionDashboardItemDto[]): SalesActionDashboardItemDto[] {
  return [...items].sort((left, right) => {
    const severityDelta = severityRank(right.severity) - severityRank(left.severity);
    if (severityDelta !== 0) return severityDelta;
    return itemTime(right) - itemTime(left);
  });
}

function failureDetail(code: string | null, message: string | null): string {
  if (code && message) return `${code}: ${message}`;
  return message ?? code ?? "Attention is required before automation can continue.";
}

function domainEventPayloadString(event: { payload: Prisma.JsonValue }, key: string): string | null {
  const payload = event.payload as Prisma.JsonObject;
  const value = payload[key];
  return typeof value === "string" ? value : null;
}

function domainEventTitle(eventType: string, aggregateType: string): string {
  const labels: Record<string, string> = {
    EMAIL_SEND_REQUESTED: "Email delivery job failed",
    FOLLOWUP_EMAIL_SEND_REQUESTED: "Follow-up email job failed",
    WHATSAPP_SEND_REQUESTED: "WhatsApp delivery job failed",
    CALL_REQUESTED: "Calling job failed",
    CALL_AUTOMATION_ATTEMPT_DUE: "Calling attempt job failed",
    PROPOSAL_SEND_REQUESTED: "Proposal delivery job failed",
    MEETING_CONFIRMATION_SEND_REQUESTED: "Meeting notification job failed",
    MEETING_CONFIRMED: "Confirmed meeting sync failed",
    MEETING_REQUESTED: "Meeting request bookkeeping failed",
    NOTIFICATION_ACKNOWLEDGED: "Notification acknowledgement bookkeeping failed"
  };
  return labels[eventType] ?? `${aggregateType} job failed (${eventType})`;
}

export async function getSalesActionDashboard(
  actor: AuthenticatedUser
): Promise<SalesActionDashboardDto> {
  const leadWhere = leadVisibilityWhere(actor);
  const notificationWhere = notificationVisibilityWhere(actor);
  const managersCanSeeOperations = canSeeAll(actor);

  const [
    waitingProposals,
    notifications,
    handoffs,
    takeovers,
    meetingRequests,
    failedFollowUpSequences,
    failedFollowUpAttempts,
    failedWhatsAppMessages,
    failedProposals,
    failedDomainEvents
  ] = await Promise.all([
    prisma.proposal.findMany({
      where: { status: "WAITING_APPROVAL", lead: leadWhere },
      include: proposalInclude,
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
      take: DASHBOARD_LIMIT
    }),
    prisma.internalNotification.findMany({
      where: {
        status: { in: ["UNREAD", "ATTENTION_REQUIRED", "ESCALATED"] },
        ...notificationWhere
      },
      include: {
        lead: { include: { company: true, contact: true, owner: true, stage: true } },
        negotiationHandoff: { include: { assignedOwner: true } }
      },
      orderBy: [{ severity: "desc" }, { createdAt: "desc" }],
      take: DASHBOARD_LIMIT
    }),
    prisma.negotiationHandoff.findMany({
      where: { status: { in: ["ACTIVE", "ATTENTION_REQUIRED"] }, lead: leadWhere },
      include: {
        lead: { include: { company: true, contact: true, owner: true, stage: true } },
        assignedOwner: true
      },
      orderBy: [{ createdAt: "desc" }],
      take: DASHBOARD_LIMIT
    }),
    prisma.humanTakeover.findMany({
      where: { status: "ACTIVE", lead: leadWhere },
      include: {
        lead: { include: { company: true, contact: true, owner: true, stage: true } },
        takenOverBy: true
      },
      orderBy: [{ createdAt: "desc" }],
      take: DASHBOARD_LIMIT
    }),
    prisma.meetingRequest.findMany({
      where: {
        status: { in: ["CONFIRMATION_REQUIRED", "ATTENTION_REQUIRED", "PROVIDER_PENDING"] },
        lead: leadWhere
      },
      include: {
        lead: { include: { company: true, contact: true, owner: true, stage: true } },
        slots: { orderBy: { startsAt: "asc" } }
      },
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
      take: DASHBOARD_LIMIT
    }),
    prisma.followUpSequence.findMany({
      where: { status: "ATTENTION_REQUIRED", lead: leadWhere },
      include: { lead: { include: { company: true, contact: true, owner: true, stage: true } } },
      orderBy: [{ updatedAt: "desc" }],
      take: DASHBOARD_LIMIT
    }),
    prisma.followUpAttempt.findMany({
      where: {
        status: { in: ["FAILED", "BLOCKED"] },
        lead: leadWhere
      },
      include: { lead: { include: { company: true, contact: true, owner: true, stage: true } } },
      orderBy: [{ updatedAt: "desc" }],
      take: DASHBOARD_LIMIT
    }),
    prisma.outboundWhatsAppMessage.findMany({
      where: {
        status: { in: ["FAILED", "BLOCKED", "NOT_CONFIGURED"] },
        lead: leadWhere
      },
      include: { lead: { include: { company: true, contact: true, owner: true, stage: true } } },
      orderBy: [{ updatedAt: "desc" }],
      take: DASHBOARD_LIMIT
    }),
    prisma.proposal.findMany({
      where: {
        zohoTimelineSyncStatus: { in: ["FAILED", "NOT_CONFIGURED"] },
        lead: leadWhere
      },
      include: proposalInclude,
      orderBy: [{ updatedAt: "desc" }],
      take: DASHBOARD_LIMIT
    }),
    managersCanSeeOperations
      ? prisma.domainEventOutbox.findMany({
          where: {
            status: { in: ["FAILED", "ATTENTION_REQUIRED"] },
            eventType: {
              notIn: [
                "MEETING_REQUESTED",
                "NOTIFICATION_ACKNOWLEDGED",
                "PROPOSAL_GENERATED",
                "PROPOSAL_APPROVED",
                "PROPOSAL_SENT"
              ]
            }
          },
          orderBy: [{ priority: "desc" }, { updatedAt: "desc" }],
          take: DASHBOARD_LIMIT
        })
      : Promise.resolve([])
  ]);

  const pendingProposalApprovals: SalesActionDashboardItemDto[] = waitingProposals.map(
    (proposal) => ({
      id: `proposal:${proposal.id}`,
      type: "PROPOSAL_APPROVAL",
      severity: "WARNING",
      title: "Proposal waiting for approval",
      detail: proposal.title,
      status: proposal.status,
      leadId: proposal.leadId,
      conversationId: null,
      proposalId: proposal.id,
      sourceEntityType: "Proposal",
      sourceEntityId: proposal.id,
      occurredAt: proposal.updatedAt.toISOString(),
      lead: toLeadDto(proposal.lead)
    })
  );

  const internalAlerts: SalesActionDashboardItemDto[] = notifications.map((notification) => {
    const dto = toInternalNotificationDto(notification);
    return {
      id: `notification:${dto.id}`,
      type: dto.type === "MEETING_CONFIRMATION" ? "MEETING_CONFIRMATION" : "NEGOTIATION_HANDOFF",
      severity: dto.severity,
      title: dto.title,
      detail: dto.body,
      status: dto.status,
      leadId: dto.leadId,
      conversationId: dto.conversationId,
      proposalId: null,
      sourceEntityType: dto.sourceEntityType,
      sourceEntityId: dto.sourceEntityId,
      occurredAt: dto.createdAt,
      lead: notification.lead ? toLeadDto(notification.lead) : null
    };
  });

  const handoffItems: SalesActionDashboardItemDto[] = handoffs.map((handoff) => {
    const dto = toNegotiationHandoffDto(handoff);
    return {
      id: `negotiation-handoff:${dto.id}`,
      type: "NEGOTIATION_HANDOFF",
      severity: dto.status === "ATTENTION_REQUIRED" ? "CRITICAL" : "WARNING",
      title:
        dto.status === "ATTENTION_REQUIRED"
          ? "Negotiation handoff needs attention"
          : "Negotiation handoff active",
      detail: dto.failureMessage ?? dto.summary,
      status: dto.status,
      leadId: dto.leadId,
      conversationId: dto.conversationId,
      proposalId: null,
      sourceEntityType: "NegotiationHandoff",
      sourceEntityId: dto.id,
      occurredAt: dto.createdAt,
      lead: toLeadDto(handoff.lead)
    };
  });

  const takeoverItems: SalesActionDashboardItemDto[] = takeovers.map((takeover) => {
    const dto = toHumanTakeoverDto(takeover);
    return {
      id: `human-takeover:${dto.id}`,
      type: "HUMAN_TAKEOVER",
      severity: "INFO",
      title: "Human takeover active",
      detail:
        dto.reason ?? `Taken over by ${dto.takenOverBy.firstName} ${dto.takenOverBy.lastName}`,
      status: dto.status,
      leadId: dto.leadId,
      conversationId: dto.conversationId,
      proposalId: null,
      sourceEntityType: "HumanTakeover",
      sourceEntityId: dto.id,
      occurredAt: dto.createdAt,
      lead: toLeadDto(takeover.lead)
    };
  });

  const meetingItems: SalesActionDashboardItemDto[] = meetingRequests.map((request) => ({
    id: `meeting-request:${request.id}`,
    type: "MEETING_CONFIRMATION",
    severity: request.status === "ATTENTION_REQUIRED" ? "CRITICAL" : "WARNING",
    title:
      request.status === "ATTENTION_REQUIRED"
        ? "Meeting scheduling needs attention"
        : "Meeting slots need confirmation",
    detail:
      request.status === "ATTENTION_REQUIRED"
        ? (request.providerLastError ?? request.zohoLastError ?? "Meeting workflow requires review")
        : `${String(
            request.slots.filter((slot) => slot.status === "PROPOSED").length
          )} proposed slot(s) waiting for confirmation`,
    status: request.status,
    leadId: request.leadId,
    conversationId: request.conversationId,
    proposalId: null,
    sourceEntityType: "MeetingRequest",
    sourceEntityId: request.id,
    occurredAt: request.updatedAt.toISOString(),
    lead: toLeadDto(request.lead)
  }));

  const sequenceFailures: SalesActionDashboardItemDto[] = failedFollowUpSequences.map(
    (sequence) => ({
      id: `follow-up-sequence:${sequence.id}`,
      type: "FAILURE",
      severity: "CRITICAL",
      title: "Follow-up sequence requires attention",
      detail: failureDetail(sequence.lastErrorCode, sequence.lastErrorMessage),
      status: sequence.status,
      leadId: sequence.leadId,
      conversationId: sequence.conversationId,
      proposalId: null,
      sourceEntityType: "FollowUpSequence",
      sourceEntityId: sequence.id,
      occurredAt: sequence.updatedAt.toISOString(),
      lead: toLeadDto(sequence.lead)
    })
  );

  const attemptFailures: SalesActionDashboardItemDto[] = failedFollowUpAttempts.map((attempt) => ({
    id: `follow-up-attempt:${attempt.id}`,
    type: "FAILURE",
    severity: attempt.status === "FAILED" ? "CRITICAL" : "WARNING",
    title: "Follow-up attempt blocked",
    detail: failureDetail(attempt.failureCode, attempt.failureMessage),
    status: attempt.status,
    leadId: attempt.leadId,
    conversationId: null,
    proposalId: null,
    sourceEntityType: "FollowUpAttempt",
    sourceEntityId: attempt.id,
    occurredAt: attempt.updatedAt.toISOString(),
    lead: toLeadDto(attempt.lead)
  }));

  const proposalFailures: SalesActionDashboardItemDto[] = failedProposals.map((proposal) => ({
    id: `proposal-sync:${proposal.id}`,
    type: "FAILURE",
    severity: proposal.zohoTimelineSyncStatus === "FAILED" ? "CRITICAL" : "WARNING",
    title: "Proposal timeline sync requires attention",
    detail: proposal.zohoTimelineLastError ?? proposal.zohoTimelineSyncStatus.replaceAll("_", " "),
    status: proposal.zohoTimelineSyncStatus,
    leadId: proposal.leadId,
    conversationId: null,
    proposalId: proposal.id,
    sourceEntityType: "Proposal",
    sourceEntityId: proposal.id,
    occurredAt: proposal.updatedAt.toISOString(),
    lead: toLeadDto(proposal.lead)
  }));

  const whatsAppFailures: SalesActionDashboardItemDto[] = failedWhatsAppMessages.map((message) => ({
    id: `whatsapp-message:${message.id}`,
    type: "FAILURE",
    severity: message.status === "BLOCKED" ? "WARNING" : "CRITICAL",
    title: "WhatsApp message requires attention",
    detail: failureDetail(message.failureCode, message.failureMessage),
    status: message.status,
    leadId: message.leadId,
    conversationId: message.conversationId,
    proposalId: null,
    sourceEntityType: "OutboundWhatsAppMessage",
    sourceEntityId: message.id,
    occurredAt: message.updatedAt.toISOString(),
    lead: toLeadDto(message.lead)
  }));

  // The durable WhatsApp job and its outbound message are two persisted views
  // of one attempt. Keep the outbound record as the actionable failure because
  // it has the lead/provider context, and avoid showing the same attempt twice.
  const failedWhatsAppAttemptIds = new Set(
    failedWhatsAppMessages
      .map((message) => message.callingAttemptId)
      .filter((attemptId): attemptId is string => Boolean(attemptId))
  );
  const outboxFailures: SalesActionDashboardItemDto[] = failedDomainEvents
    .filter(
      (event) =>
        !(
          event.eventType === "WHATSAPP_SEND_REQUESTED" &&
          failedWhatsAppAttemptIds.has(domainEventPayloadString(event, "callingAttemptId") ?? "")
        )
    )
    .map((event) => ({
    id: `domain-event:${event.id}`,
    type: "FAILURE",
    severity: event.status === "ATTENTION_REQUIRED" ? "CRITICAL" : "WARNING",
    title: domainEventTitle(event.eventType, event.aggregateType),
    detail: failureDetail(event.lastErrorCode, event.lastErrorMessage),
    status: event.status,
    leadId: null,
    conversationId: null,
    proposalId: null,
    sourceEntityType: `DomainEventOutbox:${event.eventType}`,
    sourceEntityId: event.id,
    occurredAt: event.updatedAt.toISOString(),
    lead: null
    }));

  const negotiationAndTakeoverAlerts = sortItems([
    ...internalAlerts,
    ...handoffItems,
    ...takeoverItems
  ]).slice(0, DASHBOARD_LIMIT);
  const failuresRequiringAttention = sortItems([
    ...sequenceFailures,
    ...attemptFailures,
    ...whatsAppFailures,
    ...proposalFailures,
    ...outboxFailures
  ]).slice(0, DASHBOARD_LIMIT);
  const actionItems = sortItems([
    ...pendingProposalApprovals,
    ...negotiationAndTakeoverAlerts,
    ...meetingItems,
    ...failuresRequiringAttention
  ]);

  return {
    generatedAt: new Date().toISOString(),
    pendingProposalApprovals,
    negotiationAndTakeoverAlerts,
    failuresRequiringAttention,
    meetings: {
      status: "AVAILABLE",
      items: sortItems(meetingItems),
      message:
        meetingItems.length === 0
          ? "No persisted meeting request requires action."
          : "Persisted meeting requests are awaiting confirmation or attention."
    },
    actionItems,
    summary: {
      pendingProposalApprovals: pendingProposalApprovals.length,
      negotiationAndTakeoverAlerts: negotiationAndTakeoverAlerts.length,
      failuresRequiringAttention: failuresRequiringAttention.length,
      meetings: meetingItems.length,
      totalActionItems: actionItems.length
    }
  };
}
