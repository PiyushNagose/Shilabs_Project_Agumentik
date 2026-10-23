import { randomUUID } from "node:crypto";
import { Prisma, type DomainEventOutbox, type PrismaClient } from "@prisma/client";
import { PermanentDomainEventError } from "../domain-events/domain-event.errors.js";
import {
  WorkerAwsSesProvider,
  type WorkerEmailProvider
} from "../integrations/aws-ses.provider.js";
import { getWorkerSelectedEmailConfig } from "../integrations/email.config.js";
import { WorkerMailpitProvider } from "../integrations/mailpit.provider.js";

function object(value: Prisma.JsonValue): Prisma.JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

export class NotificationDeliveryService {
  public constructor(
    private readonly db: PrismaClient,
    private readonly env: NodeJS.ProcessEnv = process.env,
    private readonly provider?: WorkerEmailProvider
  ) {}

  public async deliver(event: DomainEventOutbox): Promise<void> {
    if (
      event.eventType !== "NOTIFICATION_ESCALATED" ||
      event.aggregateType !== "InternalNotification" ||
      !event.workspaceId
    ) {
      throw new PermanentDomainEventError("NOTIFICATION_EVENT_INVALID", "Invalid escalation event");
    }
    // The aggregate and persisted workspace are authoritative, never payload addresses or IDs.
    const notification = await this.db.internalNotification.findFirst({
      where: { id: event.aggregateId, workspaceId: event.workspaceId }
    });
    if (notification?.escalationStatus !== "ESCALATED") {
      throw new PermanentDomainEventError(
        "NOTIFICATION_NOT_FOUND",
        "Escalation is not in this workspace"
      );
    }
    const evidence = object(notification.escalationEvidence);
    const previous = object(evidence.delivery ?? null);
    if (
      previous.state === "Accepted" ||
      previous.state === "Disabled" ||
      previous.state === "NeedsAttention"
    )
      return;

    const config = getWorkerSelectedEmailConfig(this.env);
    const token = randomUUID();
    const base: Prisma.InputJsonObject = {
      channel: "EMAIL",
      eventId: event.id,
      attemptId: token,
      provider: config.provider,
      updatedAt: new Date().toISOString()
    };
    let currentEvidence: Prisma.InputJsonObject = evidence;
    let nullEvidence = notification.escalationEvidence === null;
    const transition = async (delivery: Prisma.InputJsonObject): Promise<boolean> => {
      const next = { ...evidence, delivery: { ...base, ...delivery } } as Prisma.InputJsonObject;
      const changed = await this.db.$transaction(async (tx) => {
        const result = await tx.internalNotification.updateMany({
          where: {
            id: notification.id,
            workspaceId: event.workspaceId,
            escalationStatus: "ESCALATED",
            escalationEvidence: {
              equals: nullEvidence ? Prisma.AnyNull : (currentEvidence as Prisma.InputJsonValue)
            }
          },
          data: { escalationEvidence: next }
        });
        if (result.count !== 1) return false;
        await tx.auditEvent.create({
          data: {
            workspaceId: event.workspaceId,
            actorType: "SYSTEM",
            entityType: "InternalNotification",
            entityId: notification.id,
            action: "NOTIFICATION_EMAIL_DELIVERY_UPDATED",
            after: next.delivery as Prisma.InputJsonObject
          }
        });
        return true;
      });
      if (changed) {
        currentEvidence = next;
        nullEvidence = false;
      }
      return changed;
    };

    if (this.env.NOTIFICATION_ESCALATION_ENABLED !== "true") {
      await transition({ state: "Disabled", code: "NOTIFICATION_EMAIL_DISABLED" });
      return;
    }
    if (config.status !== "CONFIGURED") {
      await transition({ state: "NeedsAttention", code: "EMAIL_NOT_CONFIGURED" });
      return;
    }
    if (
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(config.fromEmail) ||
      !Number.isFinite(config.timeoutMs) ||
      config.timeoutMs <= 0 ||
      config.timeoutMs > 120_000
    ) {
      await transition({ state: "NeedsAttention", code: "EMAIL_CONFIG_INVALID" });
      return;
    }

    const members = await this.db.workspaceMember.findMany({
      where: {
        workspaceId: event.workspaceId,
        status: "ACTIVE",
        workspace: { status: "ACTIVE" },
        role: { in: ["OWNER", "ADMIN", "SALES_MANAGER"] },
        user: { status: "ACTIVE" }
      },
      include: { user: { select: { email: true } } },
      orderBy: [{ joinedAt: "asc" }, { userId: "asc" }]
    });
    const recipient =
      members.find((member) => member.userId === notification.assignedToUserId) ??
      members.find((member) => member.role === "OWNER") ??
      members[0];
    if (!recipient || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient.user.email)) {
      await transition({ state: "NeedsAttention", code: "ACTIVE_INTERNAL_RECIPIENT_MISSING" });
      return;
    }
    const provider =
      this.provider ??
      (config.provider === "MAILPIT"
        ? new WorkerMailpitProvider(config)
        : new WorkerAwsSesProvider({ ...config, maxRetries: 0 }));

    // Neither SMTP nor SES deduplicates this key. Commit a non-retryable claim before I/O.
    // A crash leaves NeedsAttention, so an outbox replay cannot resend an ambiguous send.
    const recipientEvidence = { recipientUserId: recipient.userId };
    if (
      !(await transition({
        ...recipientEvidence,
        state: "NeedsAttention",
        code: "SEND_OUTCOME_UNCONFIRMED"
      }))
    )
      return;

    let providerMessageId: string;
    try {
      const result = await provider.sendEmail({
        to: recipient.user.email,
        from: config.fromEmail,
        // Internal alerts must not inherit a customer-facing reply-to address.
        subject: `Escalation: ${notification.title.replace(/[\r\n]/g, " ")}`,
        textBody: [
          notification.body,
          notification.escalationReason,
          `Notification: ${notification.id}`,
          notification.escalationDueAt ? `Due: ${notification.escalationDueAt.toISOString()}` : null
        ]
          .filter(Boolean)
          .join("\n\n"),
        configurationSet: config.provider === "AWS_SES" ? config.configurationSet : null,
        idempotencyKey: `notification-escalation:${notification.id}`
      });
      if (!result.providerMessageId.trim()) throw new Error("Missing acceptance evidence");
      providerMessageId = result.providerMessageId;
    } catch (error) {
      // Only a definitive SES rate-limit rejection proves no message was accepted.
      const throttled =
        config.provider === "AWS_SES" &&
        error instanceof Error &&
        ["TooManyRequestsException", "ThrottlingException"].includes(error.name);
      if (throttled) {
        const exhausted = event.attempts >= event.maxAttempts;
        await transition({
          ...recipientEvidence,
          state: exhausted ? "NeedsAttention" : "Pending",
          code: exhausted ? "RETRY_EXHAUSTED" : "PROVIDER_THROTTLED"
        });
        if (!exhausted)
          throw new Error("Internal notification provider throttled; retry permitted");
      } else {
        await transition({
          ...recipientEvidence,
          state: "NeedsAttention",
          code: "SEND_OUTCOME_UNCONFIRMED"
        });
      }
      return;
    }
    // Persistence errors after acceptance must escape without making the send retryable.
    await transition({
      ...recipientEvidence,
      state: "Accepted",
      providerMessageId,
      acceptedAt: new Date().toISOString()
    });
  }
}
