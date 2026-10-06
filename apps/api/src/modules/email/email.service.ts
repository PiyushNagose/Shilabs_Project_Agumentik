import crypto from "node:crypto";
import {
  EmailProviderEventType,
  EmailSuppressionReason,
  IntegrationAccountStatus,
  LeadStatus,
  type EmailDeliverabilityScan,
  type EmailSuppression,
  type InboundEmail,
  Prisma,
  UserStatus,
  type OutboundEmail
} from "@prisma/client";
import type {
  EmailDeliverabilityScanDto,
  EmailPreSendValidationDto,
  EmailSuppressionDto,
  InboundEmailDto,
  IntegrationHealthDto,
  OutboundEmailDto,
  SesFeedbackEventDto,
  SesInboundEmailDto
} from "@shilabs/shared-types";
import { normalizeEmail } from "@shilabs/validation";
import { getAwsSesConfig, type AwsSesConfiguredConfig } from "../../config/aws-ses.js";
import {
  getSelectedEmailProviderConfig,
  type SelectedEmailProviderConfig
} from "../../config/email-provider.js";
import { AppError } from "../../shared/errors.js";
import { prisma } from "../../shared/prisma.js";
import { redactSecrets } from "../../shared/redaction.js";
import type { AuthenticatedUser } from "../auth/auth.types.js";
import { upsertIntegrationAccount } from "../integrations/integration-mapping.repository.js";
import { AwsSesProvider } from "../integrations/aws-ses/aws-ses.provider.js";
import { MailpitEmailProvider } from "../integrations/mailpit/mailpit.provider.js";
import { publishRealtimeEvent } from "../realtime/realtime.service.js";
import type { EmailProvider } from "./email.provider.js";
import {
  sesNotificationSchema,
  sesInboundNotificationSchema,
  snsWrappedSesNotificationSchema,
  type SesInboundNotification,
  type SesNotification
} from "./email-feedback.schemas.js";
import type {
  CreateEmailSuppressionInput,
  E2ECustomerReplyInput,
  SendEmailInput,
  ValidatePreSendEmailInput
} from "./email.schemas.js";

interface SendEmailOptions {
  env?: NodeJS.ProcessEnv;
  provider?: EmailProvider;
}

interface FeedbackHeaders {
  signature?: string;
  timestamp?: string;
}

const E2E_INBOUND_WEBHOOK_SECRET_ENV = "E2E_INBOUND_EMAIL_WEBHOOK_SECRET";

type LeadWithContact = Prisma.LeadGetPayload<{ include: { contact: true } }>;

function sanitizeError(error: unknown): string {
  if (error instanceof Error) return redactSecrets(error.message).slice(0, 500);
  return "Email provider operation failed";
}

function assertE2ELocalInboundEnabled(env: NodeJS.ProcessEnv): void {
  if (env.APP_ENV !== "e2e-local" || env.NODE_ENV === "production") {
    throw new AppError(404, "NOT_FOUND", "E2E customer reply ingestion is not available");
  }
}

function firstNonEmpty(...values: (string | undefined)[]): string | null {
  return (
    values.map((value) => value?.trim()).find((value): value is string => Boolean(value)) ?? null
  );
}

function getE2EInboundSigningConfig(env: NodeJS.ProcessEnv): {
  fromEmail: string;
  webhookSecret: string;
  providerEnv: NodeJS.ProcessEnv;
} {
  const fromEmail =
    firstNonEmpty(env.AWS_SES_FROM_EMAIL, env.MAILPIT_FROM_EMAIL) ?? "sales@shilabs.local";
  const webhookSecret =
    firstNonEmpty(env.AWS_SES_WEBHOOK_SECRET, env[E2E_INBOUND_WEBHOOK_SECRET_ENV]) ?? "";
  if (!webhookSecret) {
    throw new AppError(503, "PROVIDER_ERROR", "E2E inbound email signing is not configured", {
      missingConfig: [E2E_INBOUND_WEBHOOK_SECRET_ENV]
    });
  }

  return {
    fromEmail,
    webhookSecret,
    providerEnv: {
      ...env,
      AWS_SES_REGION: firstNonEmpty(env.AWS_SES_REGION) ?? "local-e2e",
      AWS_SES_FROM_EMAIL: fromEmail,
      AWS_SES_USE_DEFAULT_CREDENTIAL_CHAIN: "true",
      AWS_SES_WEBHOOK_SECRET: webhookSecret
    }
  };
}

function signInboundPayload(rawBody: string, secret: string): FeedbackHeaders {
  const timestamp = String(Date.now());
  const signature = `sha256=${crypto
    .createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex")}`;
  return { timestamp, signature };
}

function toOutboundEmailDto(email: OutboundEmail): OutboundEmailDto {
  return {
    id: email.id,
    leadId: email.leadId,
    contactId: email.contactId,
    actorUserId: email.actorUserId,
    toEmail: email.toEmail,
    fromEmail: email.fromEmail,
    replyToEmail: email.replyToEmail,
    subject: email.subject,
    provider: email.provider,
    providerMessageId: email.providerMessageId,
    idempotencyKey: email.idempotencyKey,
    status: email.status,
    failureCode: email.failureCode,
    failureMessage: email.failureMessage,
    sentAt: email.sentAt?.toISOString() ?? null,
    deliveredAt: email.deliveredAt?.toISOString() ?? null,
    bouncedAt: email.bouncedAt?.toISOString() ?? null,
    complainedAt: email.complainedAt?.toISOString() ?? null,
    createdAt: email.createdAt.toISOString(),
    updatedAt: email.updatedAt.toISOString()
  };
}

function displayEmailProvider(provider: SelectedEmailProviderConfig["provider"]): string {
  return provider === "MAILPIT" ? "Mailpit" : "AWS SES";
}

function emailProviderSecretRef(config: SelectedEmailProviderConfig): string | null {
  if (config.provider === "MAILPIT") return null;
  return config.useDefaultCredentialChain
    ? "aws-default-credential-chain"
    : "env:AWS_SES_SECRET_ACCESS_KEY";
}

function emailProviderPublicConfig(config: SelectedEmailProviderConfig): Prisma.InputJsonObject {
  if (config.provider === "MAILPIT") {
    return {
      host: config.host,
      port: config.port,
      secure: config.secure,
      fromEmailConfigured: Boolean(config.fromEmail)
    };
  }

  return {
    region: config.region,
    fromEmailConfigured: Boolean(config.fromEmail),
    configurationSet: config.configurationSet
  };
}

function buildConfiguredEmailProvider(config: SelectedEmailProviderConfig): EmailProvider {
  if (config.provider === "MAILPIT") return new MailpitEmailProvider(config);
  return new AwsSesProvider(config as AwsSesConfiguredConfig);
}

function toInboundEmailDto(email: InboundEmail): InboundEmailDto {
  return {
    id: email.id,
    provider: "AWS_SES",
    providerMessageId: email.providerMessageId,
    providerEventId: email.providerEventId,
    leadId: email.leadId,
    contactId: email.contactId,
    conversationId: email.conversationId,
    messageId: email.messageId,
    fromEmail: email.fromEmail,
    toEmails: email.toEmails,
    subject: email.subject,
    textBody: email.textBody,
    status: email.status,
    failureCode: email.failureCode,
    failureMessage: email.failureMessage,
    replyProcessingStatus: email.replyProcessingStatus,
    receivedAt: email.receivedAt.toISOString(),
    processedAt: email.processedAt?.toISOString() ?? null,
    createdAt: email.createdAt.toISOString(),
    updatedAt: email.updatedAt.toISOString()
  };
}

function toEmailSuppressionDto(suppression: EmailSuppression): EmailSuppressionDto {
  return {
    id: suppression.id,
    email: suppression.email,
    normalizedEmail: suppression.normalizedEmail,
    reason: suppression.reason,
    source: suppression.source,
    provider: suppression.provider,
    providerEventId: suppression.providerEventId,
    createdByUserId: suppression.createdByUserId,
    createdAt: suppression.createdAt.toISOString(),
    updatedAt: suppression.updatedAt.toISOString()
  };
}

function toEmailDeliverabilityScanDto(scan: EmailDeliverabilityScan): EmailDeliverabilityScanDto {
  return {
    id: scan.id,
    status: scan.status,
    requestedByUserId: scan.requestedByUserId,
    startedAt: scan.startedAt.toISOString(),
    finishedAt: scan.finishedAt?.toISOString() ?? null,
    totalContacts: scan.totalContacts,
    eligibleContacts: scan.eligibleContacts,
    suppressedContacts: scan.suppressedContacts,
    invalidContacts: scan.invalidContacts,
    doNotContactContacts: scan.doNotContactContacts,
    terminalLeadContacts: scan.terminalLeadContacts,
    createdSuppressions: scan.createdSuppressions,
    lastError: scan.lastError,
    createdAt: scan.createdAt.toISOString(),
    updatedAt: scan.updatedAt.toISOString()
  };
}

function isForbiddenLeadStatus(status: LeadStatus): boolean {
  return status === "WON" || status === "LOST" || status === "DISQUALIFIED";
}

function isValidEmailAddress(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value);
}

function assertActiveEmailActor(actor: AuthenticatedUser): void {
  if (actor.status !== UserStatus.ACTIVE) {
    throw new AppError(403, "AUTHORIZATION_ERROR", "Insufficient email permissions");
  }
}

interface EmailSendEligibility {
  allowed: boolean;
  lead: LeadWithContact;
  normalizedEmail: string | null;
  code: string | null;
  message: string | null;
  suppression: EmailSuppression | null;
}

async function assessLeadEmailSendEligibility(leadId: string): Promise<EmailSendEligibility> {
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    include: { contact: true }
  });
  if (!lead) throw new AppError(404, "NOT_FOUND", "Lead not found");

  if (!lead.contact.email) {
    return {
      allowed: false,
      lead,
      normalizedEmail: null,
      code: "CONTACT_EMAIL_MISSING",
      message: "Lead contact does not have an email address",
      suppression: null
    };
  }

  const normalizedEmail = normalizeEmail(lead.contact.email);
  if (!normalizedEmail || !isValidEmailAddress(normalizedEmail)) {
    return {
      allowed: false,
      lead,
      normalizedEmail,
      code: "CONTACT_EMAIL_INVALID",
      message: "Lead contact email address is invalid",
      suppression: null
    };
  }

  if (lead.contact.doNotContact) {
    return {
      allowed: false,
      lead,
      normalizedEmail,
      code: "CONTACT_DO_NOT_CONTACT",
      message: "Contact is marked do not contact",
      suppression: null
    };
  }

  if (isForbiddenLeadStatus(lead.status)) {
    return {
      allowed: false,
      lead,
      normalizedEmail,
      code: "LEAD_STATUS_FORBIDS_OUTREACH",
      message: `Lead status ${lead.status} forbids outbound outreach`,
      suppression: null
    };
  }

  const suppression = await prisma.emailSuppression.findUnique({
    where: { normalizedEmail }
  });
  if (suppression) {
    return {
      allowed: false,
      lead,
      normalizedEmail,
      code: "EMAIL_SUPPRESSED",
      message: `Email address is suppressed: ${suppression.reason}`,
      suppression
    };
  }

  return {
    allowed: true,
    lead,
    normalizedEmail,
    code: null,
    message: null,
    suppression: null
  };
}

function toPreSendValidationDto(eligibility: EmailSendEligibility): EmailPreSendValidationDto {
  return {
    allowed: eligibility.allowed,
    leadId: eligibility.lead.id,
    contactId: eligibility.lead.contactId,
    normalizedEmail: eligibility.normalizedEmail,
    code: eligibility.code,
    message: eligibility.message,
    suppression: eligibility.suppression ? toEmailSuppressionDto(eligibility.suppression) : null
  };
}

async function markEmailBlocked(input: {
  emailId: string;
  code: string;
  message: string;
  actorId: string;
}): Promise<OutboundEmail> {
  return prisma.$transaction(async (tx) => {
    const email = await tx.outboundEmail.update({
      where: { id: input.emailId },
      data: {
        status: "BLOCKED",
        failureCode: input.code,
        failureMessage: input.message
      }
    });

    await tx.auditEvent.create({
      data: {
        actorType: "USER",
        actorId: input.actorId,
        entityType: "OutboundEmail",
        entityId: email.id,
        action: "EMAIL_BLOCKED",
        after: {
          code: input.code,
          message: input.message
        }
      }
    });

    return email;
  });
}

async function recordSendFailure(input: {
  emailId: string;
  code: string;
  message: string;
  actorId: string;
}): Promise<OutboundEmail> {
  return prisma.$transaction(async (tx) => {
    const email = await tx.outboundEmail.update({
      where: { id: input.emailId },
      data: {
        status: "FAILED",
        failureCode: input.code,
        failureMessage: input.message
      }
    });

    await tx.auditEvent.create({
      data: {
        actorType: "USER",
        actorId: input.actorId,
        entityType: "OutboundEmail",
        entityId: email.id,
        action: "EMAIL_SEND_FAILED",
        after: {
          code: input.code,
          message: input.message
        }
      }
    });

    return email;
  });
}

export async function getAwsSesHealth(input?: {
  env?: NodeJS.ProcessEnv;
  provider?: EmailProvider;
}): Promise<IntegrationHealthDto> {
  const checkedAt = new Date();
  const config = getSelectedEmailProviderConfig(input?.env);

  if (config.status === "NOT_CONFIGURED") {
    const account = await upsertIntegrationAccount({
      provider: config.provider,
      key: "default",
      displayName: displayEmailProvider(config.provider),
      status: "NOT_CONFIGURED",
      secretRef: emailProviderSecretRef(config),
      publicConfig: emailProviderPublicConfig(config),
      lastCheckedAt: checkedAt,
      lastError: `Missing configuration: ${config.missing.join(", ")}`
    });

    return {
      provider: config.provider,
      status: "NOT_CONFIGURED",
      configured: false,
      checkedAt: checkedAt.toISOString(),
      accountId: account.id,
      apiDomain: null,
      accountsUrl: null,
      missingConfig: config.missing,
      scopes: [],
      tokenExpiresAt: null,
      lastError: account.lastError
    };
  }

  try {
    const provider = input?.provider ?? buildConfiguredEmailProvider(config);
    const health = await provider.verifyConnection();
    const status = health.sendingEnabled
      ? IntegrationAccountStatus.CONFIGURED
      : IntegrationAccountStatus.ERROR;
    const account = await upsertIntegrationAccount({
      provider: config.provider,
      key: "default",
      displayName: displayEmailProvider(config.provider),
      status,
      secretRef: emailProviderSecretRef(config),
      publicConfig: emailProviderPublicConfig(config),
      lastCheckedAt: checkedAt,
      lastError: health.sendingEnabled
        ? null
        : `${displayEmailProvider(config.provider)} sending is disabled`
    });

    return {
      provider: config.provider,
      status,
      configured: true,
      checkedAt: checkedAt.toISOString(),
      accountId: account.id,
      apiDomain: null,
      accountsUrl: null,
      missingConfig: [],
      scopes: [],
      tokenExpiresAt: null,
      lastError: account.lastError
    };
  } catch (error) {
    const lastError = sanitizeError(error);
    const account = await upsertIntegrationAccount({
      provider: config.provider,
      key: "default",
      displayName: displayEmailProvider(config.provider),
      status: "ERROR",
      secretRef: emailProviderSecretRef(config),
      publicConfig: emailProviderPublicConfig(config),
      lastCheckedAt: checkedAt,
      lastError
    });

    return {
      provider: config.provider,
      status: "ERROR",
      configured: true,
      checkedAt: checkedAt.toISOString(),
      accountId: account.id,
      apiDomain: null,
      accountsUrl: null,
      missingConfig: [],
      scopes: [],
      tokenExpiresAt: null,
      lastError
    };
  }
}

export async function sendOutboundEmail(
  actor: AuthenticatedUser,
  input: SendEmailInput,
  options?: SendEmailOptions
): Promise<OutboundEmailDto> {
  assertActiveEmailActor(actor);

  const existing = await prisma.outboundEmail.findUnique({
    where: { idempotencyKey: input.idempotencyKey }
  });
  if (existing) return toOutboundEmailDto(existing);

  const eligibility = await assessLeadEmailSendEligibility(input.leadId);
  if (!eligibility.normalizedEmail || eligibility.code === "CONTACT_EMAIL_MISSING") {
    throw new AppError(409, "CONFLICT", eligibility.message ?? "Lead contact email is not usable");
  }

  const config = getSelectedEmailProviderConfig(options?.env);
  const created = await prisma.outboundEmail.create({
    data: {
      leadId: eligibility.lead.id,
      contactId: eligibility.lead.contactId,
      actorUserId: actor.id,
      toEmail: eligibility.lead.contact.email ?? eligibility.normalizedEmail,
      normalizedToEmail: eligibility.normalizedEmail,
      fromEmail: config.fromEmail || "not-configured@local.invalid",
      replyToEmail: config.replyToEmail,
      subject: input.subject,
      textBody: input.textBody ?? null,
      htmlBody: input.htmlBody ?? null,
      provider: config.provider,
      idempotencyKey: input.idempotencyKey,
      status: "PENDING"
    }
  });

  if (!eligibility.allowed) {
    return toOutboundEmailDto(
      await markEmailBlocked({
        emailId: created.id,
        code: eligibility.code ?? "EMAIL_SEND_BLOCKED",
        message: eligibility.message ?? "Email send is blocked",
        actorId: actor.id
      })
    );
  }

  if (config.status === "NOT_CONFIGURED") {
    return toOutboundEmailDto(
      await recordSendFailure({
        emailId: created.id,
        code: `${config.provider}_NOT_CONFIGURED`,
        message: `Missing configuration: ${config.missing.join(", ")}`,
        actorId: actor.id
      })
    );
  }

  try {
    const provider = options?.provider ?? buildConfiguredEmailProvider(config);
    const sent = await provider.sendEmail({
      to: created.toEmail,
      from: config.fromEmail,
      replyTo: config.replyToEmail,
      subject: created.subject,
      textBody: created.textBody,
      htmlBody: created.htmlBody,
      configurationSet: config.provider === "AWS_SES" ? config.configurationSet : null,
      idempotencyKey: created.idempotencyKey
    });

    const now = new Date();
    const updated = await prisma.$transaction(async (tx) => {
      const email = await tx.outboundEmail.update({
        where: { id: created.id },
        data: {
          status: "SENT",
          providerMessageId: sent.providerMessageId,
          sentAt: now
        }
      });

      await tx.activity.create({
        data: {
          leadId: eligibility.lead.id,
          actorUserId: actor.id,
          type: "MESSAGE_SENT",
          description: `Email sent to ${created.toEmail}: ${created.subject}`
        }
      });
      await tx.auditEvent.create({
        data: {
          actorType: "USER",
          actorId: actor.id,
          entityType: "OutboundEmail",
          entityId: email.id,
          action: "EMAIL_SENT",
          after: {
            provider: sent.provider,
            providerMessageId: sent.providerMessageId
          }
        }
      });

      return email;
    });

    return toOutboundEmailDto(updated);
  } catch (error) {
    return toOutboundEmailDto(
      await recordSendFailure({
        emailId: created.id,
        code: `${config.provider}_SEND_FAILED`,
        message: sanitizeError(error),
        actorId: actor.id
      })
    );
  }
}

export async function validateOutboundEmailPreSend(
  actor: AuthenticatedUser,
  input: ValidatePreSendEmailInput
): Promise<EmailPreSendValidationDto> {
  assertActiveEmailActor(actor);
  return toPreSendValidationDto(await assessLeadEmailSendEligibility(input.leadId));
}

export async function listEmailSuppressions(
  actor: AuthenticatedUser
): Promise<EmailSuppressionDto[]> {
  assertActiveEmailActor(actor);
  const suppressions = await prisma.emailSuppression.findMany({
    orderBy: { createdAt: "desc" },
    take: 200
  });
  return suppressions.map(toEmailSuppressionDto);
}

export async function createEmailSuppression(
  actor: AuthenticatedUser,
  input: CreateEmailSuppressionInput
): Promise<EmailSuppressionDto> {
  assertActiveEmailActor(actor);
  const normalizedEmail = normalizeEmail(input.email);
  if (!normalizedEmail || !isValidEmailAddress(normalizedEmail)) {
    throw new AppError(400, "VALIDATION_ERROR", "Suppression email address is invalid");
  }

  const suppression = await prisma.$transaction(async (tx) => {
    const created = await tx.emailSuppression.upsert({
      where: { normalizedEmail },
      create: {
        email: input.email,
        normalizedEmail,
        reason: input.reason,
        source: input.source,
        createdByUserId: actor.id
      },
      update: {
        email: input.email,
        reason: input.reason,
        source: input.source,
        createdByUserId: actor.id
      }
    });

    await tx.auditEvent.create({
      data: {
        actorType: "USER",
        actorId: actor.id,
        entityType: "EmailSuppression",
        entityId: created.id,
        action: "EMAIL_SUPPRESSION_UPSERTED",
        after: {
          normalizedEmail,
          reason: input.reason,
          source: input.source
        }
      }
    });

    return created;
  });

  return toEmailSuppressionDto(suppression);
}

export async function runEmailDeliverabilityScan(
  actor: AuthenticatedUser
): Promise<EmailDeliverabilityScanDto> {
  assertActiveEmailActor(actor);
  const started = await prisma.emailDeliverabilityScan.create({
    data: {
      status: "FAILED",
      requestedByUserId: actor.id
    }
  });

  try {
    const contacts = await prisma.contact.findMany({
      where: { email: { not: null } },
      include: { leads: { select: { status: true } } }
    });
    const suppressions = await prisma.emailSuppression.findMany({
      select: { normalizedEmail: true }
    });
    const suppressedEmails = new Set(
      suppressions.map((suppression) => suppression.normalizedEmail)
    );
    const seenInvalidEmails = new Set<string>();
    const counts = {
      totalContacts: contacts.length,
      eligibleContacts: 0,
      suppressedContacts: 0,
      invalidContacts: 0,
      doNotContactContacts: 0,
      terminalLeadContacts: 0,
      createdSuppressions: 0
    };

    for (const contact of contacts) {
      const normalizedEmail = normalizeEmail(contact.email);
      const invalid = !normalizedEmail || !isValidEmailAddress(normalizedEmail);
      const suppressed = normalizedEmail ? suppressedEmails.has(normalizedEmail) : false;
      const terminalLead = contact.leads.some((lead) => isForbiddenLeadStatus(lead.status));

      if (invalid) {
        counts.invalidContacts += 1;
        const suppressionKey = normalizedEmail ?? contact.email ?? "";
        if (suppressionKey && !seenInvalidEmails.has(suppressionKey)) {
          seenInvalidEmails.add(suppressionKey);
          const existing = normalizedEmail
            ? await prisma.emailSuppression.findUnique({ where: { normalizedEmail } })
            : null;
          if (!existing && normalizedEmail) {
            await prisma.emailSuppression.create({
              data: {
                email: contact.email ?? normalizedEmail,
                normalizedEmail,
                reason: "INVALID",
                source: "DELIVERABILITY_SCAN",
                createdByUserId: actor.id
              }
            });
            suppressedEmails.add(normalizedEmail);
            counts.createdSuppressions += 1;
          }
        }
      }
      if (suppressed) counts.suppressedContacts += 1;
      if (contact.doNotContact) counts.doNotContactContacts += 1;
      if (terminalLead) counts.terminalLeadContacts += 1;
      if (!invalid && !suppressed && !contact.doNotContact && !terminalLead) {
        counts.eligibleContacts += 1;
      }
    }

    const finishedAt = new Date();
    const scan = await prisma.$transaction(async (tx) => {
      const updated = await tx.emailDeliverabilityScan.update({
        where: { id: started.id },
        data: {
          status: "COMPLETED",
          finishedAt,
          ...counts
        }
      });

      await tx.auditEvent.create({
        data: {
          actorType: "USER",
          actorId: actor.id,
          entityType: "EmailDeliverabilityScan",
          entityId: updated.id,
          action: "EMAIL_DELIVERABILITY_SCAN_COMPLETED",
          after: counts
        }
      });

      return updated;
    });

    return toEmailDeliverabilityScanDto(scan);
  } catch (error) {
    const failed = await prisma.emailDeliverabilityScan.update({
      where: { id: started.id },
      data: {
        status: "FAILED",
        finishedAt: new Date(),
        lastError: error instanceof Error ? error.message : "Deliverability scan failed"
      }
    });
    return toEmailDeliverabilityScanDto(failed);
  }
}

function parseSesNotification(input: unknown): { eventId: string; notification: SesNotification } {
  const wrapped = snsWrappedSesNotificationSchema.safeParse(input);
  if (wrapped.success) {
    const message = JSON.parse(wrapped.data.Message) as unknown;
    return {
      eventId: wrapped.data.MessageId ?? crypto.randomUUID(),
      notification: sesNotificationSchema.parse(message)
    };
  }

  const notification = sesNotificationSchema.parse(input);
  return {
    eventId: `${notification.mail.messageId}:${notification.notificationType}`,
    notification
  };
}

function parseSesInboundNotification(input: unknown): {
  eventId: string;
  notification: SesInboundNotification;
} {
  const wrapped = snsWrappedSesNotificationSchema.safeParse(input);
  if (wrapped.success) {
    const message = JSON.parse(wrapped.data.Message) as unknown;
    return {
      eventId: wrapped.data.MessageId ?? crypto.randomUUID(),
      notification: sesInboundNotificationSchema.parse(message)
    };
  }

  const notification = sesInboundNotificationSchema.parse(input);
  return {
    eventId: `${notification.mail.messageId}:Received`,
    notification
  };
}

function eventType(notificationType: SesNotification["notificationType"]): EmailProviderEventType {
  if (notificationType === "Delivery") return EmailProviderEventType.DELIVERY;
  if (notificationType === "Bounce") return EmailProviderEventType.BOUNCE;
  return EmailProviderEventType.COMPLAINT;
}

function toFeedbackEventType(type: EmailProviderEventType): "DELIVERY" | "BOUNCE" | "COMPLAINT" {
  if (
    type === EmailProviderEventType.DELIVERY ||
    type === EmailProviderEventType.BOUNCE ||
    type === EmailProviderEventType.COMPLAINT
  ) {
    return type;
  }

  throw new AppError(409, "CONFLICT", "Provider event id belongs to another SES event type");
}

function suppressionReason(type: EmailProviderEventType): EmailSuppressionReason | null {
  if (type === EmailProviderEventType.BOUNCE) return EmailSuppressionReason.BOUNCE;
  if (type === EmailProviderEventType.COMPLAINT) return EmailSuppressionReason.COMPLAINT;
  return null;
}

function recipientEmails(notification: SesNotification): string[] {
  if (notification.notificationType === "Bounce") {
    return notification.bounce.bouncedRecipients
      .map((recipient) => recipient.emailAddress)
      .filter((email): email is string => Boolean(email));
  }

  if (notification.notificationType === "Complaint") {
    return notification.complaint.complainedRecipients
      .map((recipient) => recipient.emailAddress)
      .filter((email): email is string => Boolean(email));
  }

  return notification.mail.destination;
}

function verifyFeedbackSignature(input: {
  headers: FeedbackHeaders;
  rawBody: string;
  secret: string;
}): void {
  if (!input.headers.signature || !input.headers.timestamp) {
    throw new AppError(401, "AUTHENTICATION_ERROR", "SES webhook signature required");
  }

  const timestamp = Number(input.headers.timestamp);
  if (!Number.isFinite(timestamp) || Math.abs(Date.now() - timestamp) > 5 * 60 * 1000) {
    throw new AppError(401, "AUTHENTICATION_ERROR", "SES webhook timestamp is invalid");
  }

  const expected = `sha256=${crypto
    .createHmac("sha256", input.secret)
    .update(`${input.headers.timestamp}.${input.rawBody}`)
    .digest("hex")}`;
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(input.headers.signature);
  if (
    expectedBuffer.length !== actualBuffer.length ||
    !crypto.timingSafeEqual(expectedBuffer, actualBuffer)
  ) {
    throw new AppError(401, "AUTHENTICATION_ERROR", "SES webhook signature is invalid");
  }
}

export async function ingestSesFeedbackEvent(input: {
  body: unknown;
  rawBody: string;
  headers: FeedbackHeaders;
  env?: NodeJS.ProcessEnv;
}): Promise<SesFeedbackEventDto> {
  const config = getAwsSesConfig(input.env);
  if (config.status === "NOT_CONFIGURED") {
    throw new AppError(503, "PROVIDER_ERROR", "AWS SES webhook is not configured", {
      missingConfig: config.missing
    });
  }

  verifyFeedbackSignature({
    headers: input.headers,
    rawBody: input.rawBody,
    secret: config.webhookSecret
  });

  const { eventId, notification } = parseSesNotification(input.body);
  const type = eventType(notification.notificationType);
  const providerMessageId = notification.mail.messageId;

  const duplicate = await prisma.emailProviderEvent.findUnique({
    where: {
      provider_providerEventId: {
        provider: "AWS_SES",
        providerEventId: eventId
      }
    }
  });
  if (duplicate) {
    return {
      provider: "AWS_SES",
      status: "DUPLICATE",
      eventId,
      outboundEmailId: duplicate.outboundEmailId,
      type: toFeedbackEventType(duplicate.type)
    };
  }

  const outboundEmail = await prisma.outboundEmail.findUnique({
    where: { providerMessageId }
  });
  const processedAt = new Date();
  const reason = suppressionReason(type);

  const event = await prisma.$transaction(async (tx) => {
    const createdEvent = await tx.emailProviderEvent.create({
      data: {
        provider: "AWS_SES",
        providerEventId: eventId,
        providerMessageId,
        outboundEmailId: outboundEmail?.id,
        type,
        payload: notification as unknown as Prisma.InputJsonObject,
        processedAt
      }
    });

    if (outboundEmail) {
      await tx.outboundEmail.update({
        where: { id: outboundEmail.id },
        data:
          type === EmailProviderEventType.DELIVERY
            ? { status: "DELIVERED", deliveredAt: processedAt }
            : type === EmailProviderEventType.BOUNCE
              ? { status: "BOUNCED", bouncedAt: processedAt }
              : { status: "COMPLAINED", complainedAt: processedAt }
      });

      await tx.auditEvent.create({
        data: {
          actorType: "SYSTEM",
          entityType: "OutboundEmail",
          entityId: outboundEmail.id,
          action: `EMAIL_${type}`,
          after: {
            provider: "AWS_SES",
            providerEventId: eventId,
            providerMessageId
          }
        }
      });
    }

    if (reason) {
      for (const email of recipientEmails(notification)) {
        const normalizedEmail = normalizeEmail(email);
        if (!normalizedEmail) continue;
        await tx.emailSuppression.upsert({
          where: { normalizedEmail },
          create: {
            email,
            normalizedEmail,
            reason,
            source: "AWS_SES_FEEDBACK",
            provider: "AWS_SES",
            providerEventId: eventId
          },
          update: {
            reason,
            source: "AWS_SES_FEEDBACK",
            provider: "AWS_SES",
            providerEventId: eventId
          }
        });
      }
    }

    return createdEvent;
  });

  return {
    provider: "AWS_SES",
    status: "PROCESSED",
    eventId,
    outboundEmailId: event.outboundEmailId,
    type: toFeedbackEventType(event.type)
  };
}

function unfoldRawHeaders(rawHeaders: string): Map<string, string> {
  const headers = new Map<string, string>();
  let currentName: string | null = null;
  for (const line of rawHeaders.split(/\r?\n/)) {
    if (/^[ \t]/.test(line) && currentName) {
      headers.set(currentName, `${headers.get(currentName) ?? ""} ${line.trim()}`.trim());
      continue;
    }

    const separator = line.indexOf(":");
    if (separator <= 0) continue;
    currentName = line.slice(0, separator).trim().toLowerCase();
    headers.set(currentName, line.slice(separator + 1).trim());
  }

  return headers;
}

function parseRawEmailContent(content: string | undefined): {
  headers: Map<string, string>;
  body: string;
} {
  if (!content) return { headers: new Map<string, string>(), body: "" };
  const parts = content.split(/\r?\n\r?\n/);
  const rawHeaders = parts.shift() ?? "";
  return {
    headers: unfoldRawHeaders(rawHeaders),
    body: parts.join("\n\n").trim()
  };
}

function headerFromNotification(
  notification: SesInboundNotification,
  rawHeaders: Map<string, string>,
  name: string
): string | undefined {
  const fromArray = notification.mail.headers?.find(
    (header) => header.name.toLowerCase() === name.toLowerCase()
  )?.value;
  return fromArray ?? rawHeaders.get(name.toLowerCase());
}

function extractEmailAddress(value: string | undefined): string | null {
  if (!value) return null;
  const angleMatch = /<([^<>@\s]+@[^<>\s]+)>/.exec(value);
  if (angleMatch?.[1]) return angleMatch[1].trim();
  const directMatch = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.exec(value);
  return directMatch?.[0]?.trim() ?? null;
}

function stripHtml(value: string): string {
  return value
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizedInboundText(input: {
  notification: SesInboundNotification;
  rawBody: string;
}): string {
  const parsed = parseRawEmailContent(input.notification.content);
  const candidates = [
    input.notification.textBody?.trim(),
    input.notification.htmlBody ? stripHtml(input.notification.htmlBody) : undefined,
    parsed.body,
    input.rawBody
  ];
  const body =
    candidates.find((candidate) => candidate !== undefined && candidate.length > 0) ?? "";
  return body.trim().slice(0, 50000);
}

function receivedAtFromNotification(notification: SesInboundNotification): Date {
  const timestamp = notification.mail.timestamp ?? notification.mail.commonHeaders?.date;
  if (timestamp) {
    const parsed = new Date(timestamp);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }

  return new Date();
}

function referenceTokens(value: string | undefined): string[] {
  return (value ?? "")
    .split(/[\s,<>]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

async function findLeadForInboundEmail(input: {
  normalizedFromEmail: string;
  headers: Map<string, string>;
  notification: SesInboundNotification;
}): Promise<
  | { ok: true; leadId: string; contactId: string; conversationId: string | null }
  | { ok: false; code: string; message: string; leadId?: string; contactId?: string }
> {
  const explicitLeadId =
    input.headers.get("x-shilabs-lead-id") ??
    headerFromNotification(input.notification, input.headers, "x-shilabs-lead-id");
  if (explicitLeadId) {
    const lead = await prisma.lead.findUnique({
      where: { id: explicitLeadId },
      include: { contact: true, conversations: { where: { channel: "EMAIL" }, take: 1 } }
    });
    if (!lead) return { ok: false, code: "LEAD_NOT_FOUND", message: "Referenced lead not found" };
    if (lead.contact.normalizedEmail !== input.normalizedFromEmail) {
      return {
        ok: false,
        code: "CONTACT_EMAIL_MISMATCH",
        message: "Inbound sender does not match the referenced lead contact",
        leadId: lead.id,
        contactId: lead.contactId
      };
    }
    if (isForbiddenLeadStatus(lead.status)) {
      return {
        ok: false,
        code: "LEAD_STATUS_FORBIDS_REPLY_PROCESSING",
        message: `Lead status ${lead.status} forbids automated reply processing`,
        leadId: lead.id,
        contactId: lead.contactId
      };
    }
    return {
      ok: true,
      leadId: lead.id,
      contactId: lead.contactId,
      conversationId: lead.conversations[0]?.id ?? null
    };
  }

  const explicitOutboundId =
    input.headers.get("x-shilabs-outbound-email-id") ??
    headerFromNotification(input.notification, input.headers, "x-shilabs-outbound-email-id");
  if (explicitOutboundId) {
    const outbound = await prisma.outboundEmail.findFirst({
      where: {
        OR: [
          { id: explicitOutboundId },
          { idempotencyKey: explicitOutboundId },
          { providerMessageId: explicitOutboundId }
        ]
      },
      include: {
        lead: {
          include: { contact: true, conversations: { where: { channel: "EMAIL" }, take: 1 } }
        }
      }
    });
    if (outbound) {
      if (outbound.lead.contact.normalizedEmail !== input.normalizedFromEmail) {
        return {
          ok: false,
          code: "CONTACT_EMAIL_MISMATCH",
          message: "Inbound sender does not match the referenced outbound email contact",
          leadId: outbound.leadId,
          contactId: outbound.contactId
        };
      }
      if (isForbiddenLeadStatus(outbound.lead.status)) {
        return {
          ok: false,
          code: "LEAD_STATUS_FORBIDS_REPLY_PROCESSING",
          message: `Lead status ${outbound.lead.status} forbids automated reply processing`,
          leadId: outbound.leadId,
          contactId: outbound.contactId
        };
      }
      return {
        ok: true,
        leadId: outbound.leadId,
        contactId: outbound.contactId,
        conversationId: outbound.lead.conversations[0]?.id ?? null
      };
    }
  }

  const references = [
    ...referenceTokens(headerFromNotification(input.notification, input.headers, "in-reply-to")),
    ...referenceTokens(headerFromNotification(input.notification, input.headers, "references"))
  ];
  if (references.length > 0) {
    const outbound = await prisma.outboundEmail.findFirst({
      where: { providerMessageId: { in: references } },
      include: {
        lead: {
          include: { contact: true, conversations: { where: { channel: "EMAIL" }, take: 1 } }
        }
      }
    });
    if (outbound) {
      if (outbound.lead.contact.normalizedEmail !== input.normalizedFromEmail) {
        return {
          ok: false,
          code: "CONTACT_EMAIL_MISMATCH",
          message: "Inbound sender does not match the referenced outbound email contact",
          leadId: outbound.leadId,
          contactId: outbound.contactId
        };
      }
      return {
        ok: true,
        leadId: outbound.leadId,
        contactId: outbound.contactId,
        conversationId: outbound.lead.conversations[0]?.id ?? null
      };
    }
  }

  const leads = await prisma.lead.findMany({
    where: {
      status: { notIn: ["WON", "LOST", "DISQUALIFIED"] },
      contact: { normalizedEmail: input.normalizedFromEmail }
    },
    include: { conversations: { where: { channel: "EMAIL" }, take: 1 } },
    orderBy: { updatedAt: "desc" },
    take: 2
  });
  if (leads.length === 0) {
    return {
      ok: false,
      code: "LEAD_NOT_FOUND",
      message: "No eligible lead matched the inbound sender"
    };
  }
  if (leads.length > 1) {
    return {
      ok: false,
      code: "AMBIGUOUS_LEAD_MATCH",
      message: "Multiple eligible leads matched the inbound sender"
    };
  }

  const lead = leads[0];
  if (!lead) {
    return {
      ok: false,
      code: "LEAD_NOT_FOUND",
      message: "No eligible lead matched the inbound sender"
    };
  }
  return {
    ok: true,
    leadId: lead.id,
    contactId: lead.contactId,
    conversationId: lead.conversations[0]?.id ?? null
  };
}

export async function ingestSesInboundEmail(input: {
  body: unknown;
  rawBody: string;
  headers: FeedbackHeaders;
  env?: NodeJS.ProcessEnv;
}): Promise<SesInboundEmailDto> {
  const config = getAwsSesConfig(input.env);
  if (config.status === "NOT_CONFIGURED") {
    throw new AppError(503, "PROVIDER_ERROR", "AWS SES inbound email is not configured", {
      missingConfig: config.missing
    });
  }

  verifyFeedbackSignature({
    headers: input.headers,
    rawBody: input.rawBody,
    secret: config.webhookSecret
  });

  const { eventId, notification } = parseSesInboundNotification(input.body);
  const duplicate = await prisma.inboundEmail.findUnique({
    where: { providerMessageId: notification.mail.messageId }
  });
  if (duplicate) {
    return {
      provider: "AWS_SES",
      status: "DUPLICATE",
      inboundEmail: toInboundEmailDto(duplicate)
    };
  }

  const parsedContent = parseRawEmailContent(notification.content);
  const fromEmail =
    extractEmailAddress(notification.mail.commonHeaders?.from?.[0]) ??
    extractEmailAddress(notification.mail.source) ??
    extractEmailAddress(headerFromNotification(notification, parsedContent.headers, "from"));
  if (!fromEmail) {
    const failed = await prisma.inboundEmail.create({
      data: {
        provider: "AWS_SES",
        providerMessageId: notification.mail.messageId,
        providerEventId: eventId,
        fromEmail: "unknown@invalid.local",
        normalizedFromEmail: "unknown@invalid.local",
        toEmails: notification.mail.destination,
        subject: notification.mail.commonHeaders?.subject ?? null,
        textBody: normalizedInboundText({ notification, rawBody: input.rawBody }),
        htmlBody: notification.htmlBody ?? null,
        rawProviderPayload: notification as unknown as Prisma.InputJsonObject,
        status: "FAILED",
        failureCode: "FROM_EMAIL_MISSING",
        failureMessage: "Inbound email did not contain a usable sender address",
        receivedAt: receivedAtFromNotification(notification),
        processedAt: new Date()
      }
    });
    return { provider: "AWS_SES", status: "FAILED", inboundEmail: toInboundEmailDto(failed) };
  }

  const normalizedFromEmail = normalizeEmail(fromEmail);
  if (!normalizedFromEmail) {
    throw new AppError(400, "VALIDATION_ERROR", "Inbound sender email is invalid");
  }

  const match = await findLeadForInboundEmail({
    normalizedFromEmail,
    headers: parsedContent.headers,
    notification
  });
  const receivedAt = receivedAtFromNotification(notification);
  const textBody = normalizedInboundText({ notification, rawBody: input.rawBody });
  const toEmails = notification.mail.commonHeaders?.to ?? notification.mail.destination;
  const subject =
    notification.mail.commonHeaders?.subject ??
    headerFromNotification(notification, parsedContent.headers, "subject") ??
    null;

  if (!match.ok) {
    const failed = await prisma.inboundEmail.create({
      data: {
        provider: "AWS_SES",
        providerMessageId: notification.mail.messageId,
        providerEventId: eventId,
        leadId: match.leadId,
        contactId: match.contactId,
        fromEmail,
        normalizedFromEmail,
        toEmails,
        subject,
        textBody,
        htmlBody: notification.htmlBody ?? null,
        rawProviderPayload: notification as unknown as Prisma.InputJsonObject,
        status: "FAILED",
        failureCode: match.code,
        failureMessage: match.message,
        replyProcessingStatus: "SKIPPED",
        receivedAt,
        processedAt: new Date()
      }
    });
    return { provider: "AWS_SES", status: "FAILED", inboundEmail: toInboundEmailDto(failed) };
  }

  const processed = await prisma.$transaction(
    async (tx) => {
      const conversation =
        match.conversationId ??
        (
          await tx.conversation.create({
            data: {
              leadId: match.leadId,
              channel: "EMAIL",
              mode: "AUTO",
              status: "OPEN",
              lastMessageAt: receivedAt
            }
          })
        ).id;

      const message = await tx.message.create({
        data: {
          conversationId: conversation,
          providerMessageId: notification.mail.messageId,
          direction: "INBOUND",
          senderType: "PROSPECT",
          body: textBody,
          deliveryStatus: "DELIVERED",
          sentAt: receivedAt,
          deliveredAt: receivedAt,
          metadata: {
            provider: "AWS_SES",
            providerEventId: eventId,
            subject,
            fromEmail,
            toEmails
          }
        }
      });

      const inbound = await tx.inboundEmail.create({
        data: {
          provider: "AWS_SES",
          providerMessageId: notification.mail.messageId,
          providerEventId: eventId,
          leadId: match.leadId,
          contactId: match.contactId,
          conversationId: conversation,
          messageId: message.id,
          fromEmail,
          normalizedFromEmail,
          toEmails,
          subject,
          textBody,
          htmlBody: notification.htmlBody ?? null,
          rawProviderPayload: notification as unknown as Prisma.InputJsonObject,
          status: "PROCESSED",
          replyProcessingStatus: "PENDING",
          receivedAt,
          processedAt: new Date()
        }
      });

      await tx.conversation.update({
        where: { id: conversation },
        data: { lastMessageAt: receivedAt }
      });
      await tx.lead.update({
        where: { id: match.leadId },
        data: { lastActivityAt: receivedAt }
      });
      await tx.activity.create({
        data: {
          leadId: match.leadId,
          type: "MESSAGE_RECEIVED",
          description: `Inbound email received from ${fromEmail}: ${subject ?? "No subject"}`
        }
      });
      await tx.emailProviderEvent.create({
        data: {
          provider: "AWS_SES",
          providerEventId: eventId,
          providerMessageId: notification.mail.messageId,
          type: "INBOUND_RECEIVED",
          payload: notification as unknown as Prisma.InputJsonObject,
          processedAt: new Date()
        }
      });
      await tx.auditEvent.createMany({
        data: [
          {
            actorType: "SYSTEM",
            entityType: "InboundEmail",
            entityId: inbound.id,
            action: "EMAIL_REPLY_RECEIVED",
            after: {
              provider: "AWS_SES",
              providerMessageId: notification.mail.messageId,
              messageId: message.id,
              leadId: match.leadId
            }
          },
          {
            actorType: "SYSTEM",
            entityType: "Message",
            entityId: message.id,
            action: "REPLY_PROCESSING_TRIGGERED",
            after: {
              inboundEmailId: inbound.id,
              status: "PENDING"
            }
          }
        ]
      });
      const activeFollowUps = await tx.followUpSequence.findMany({
        where: { leadId: match.leadId, status: "ACTIVE" },
        include: { attempts: { where: { status: "SCHEDULED" } } }
      });
      const stoppedAt = new Date();
      for (const sequence of activeFollowUps) {
        await tx.followUpSequence.update({
          where: { id: sequence.id },
          data: {
            status: "STOPPED",
            stopReason: "INBOUND_REPLY_RECEIVED",
            stoppedAt
          }
        });
        await tx.followUpAttempt.updateMany({
          where: { sequenceId: sequence.id, status: "SCHEDULED" },
          data: {
            status: "CANCELLED",
            failedAt: stoppedAt,
            failureCode: "INBOUND_REPLY_RECEIVED",
            failureMessage: "Inbound reply received before scheduled follow-up executed"
          }
        });
        await tx.domainEventOutbox.updateMany({
          where: {
            id: {
              in: sequence.attempts
                .map((attempt) => attempt.domainEventId)
                .filter((id): id is string => Boolean(id))
            },
            status: { in: ["PENDING", "QUEUED"] }
          },
          data: {
            status: "ATTENTION_REQUIRED",
            deadLetteredAt: stoppedAt,
            lastErrorCode: "INBOUND_REPLY_RECEIVED",
            lastErrorMessage: "Inbound reply stopped pending follow-up automation"
          }
        });
        await tx.auditEvent.create({
          data: {
            actorType: "SYSTEM",
            entityType: "FollowUpSequence",
            entityId: sequence.id,
            action: "FOLLOW_UP_SEQUENCE_STOPPED",
            after: { leadId: match.leadId, reason: "INBOUND_REPLY_RECEIVED" }
          }
        });
      }

      const activeCallingSequences = await tx.callingSequence.findMany({
        where: { leadId: match.leadId, status: "ACTIVE" },
        include: { attempts: { where: { status: "SCHEDULED" } } }
      });
      for (const sequence of activeCallingSequences) {
        await tx.callingSequence.update({
          where: { id: sequence.id },
          data: {
            status: "STOPPED",
            stopReason: "INBOUND_EMAIL_RECEIVED",
            stoppedAt
          }
        });
        await tx.callingAttempt.updateMany({
          where: { sequenceId: sequence.id, status: "SCHEDULED" },
          data: {
            status: "SKIPPED",
            completedAt: stoppedAt,
            failureCode: "INBOUND_EMAIL_RECEIVED",
            failureMessage: "Inbound email received before scheduled call executed"
          }
        });
        await tx.domainEventOutbox.updateMany({
          where: {
            OR: [
              {
                id: {
                  in: sequence.attempts
                    .map((attempt) => attempt.domainEventId)
                    .filter((id): id is string => Boolean(id))
                }
              },
              { correlationId: sequence.id }
            ],
            status: { in: ["PENDING", "QUEUED", "PROCESSING"] }
          },
          data: {
            status: "ATTENTION_REQUIRED",
            deadLetteredAt: stoppedAt,
            lastErrorCode: "INBOUND_EMAIL_RECEIVED",
            lastErrorMessage: "Inbound email stopped pending calling/WhatsApp automation"
          }
        });
        await tx.auditEvent.create({
          data: {
            actorType: "SYSTEM",
            entityType: "CallingSequence",
            entityId: sequence.id,
            action: "CALLING_SEQUENCE_STOPPED",
            after: { leadId: match.leadId, reason: "INBOUND_EMAIL_RECEIVED" }
          }
        });
      }

      return inbound;
    },
    { maxWait: 10000, timeout: 30000 }
  );

  if (processed.leadId) {
    await publishRealtimeEvent({
      entityType: "lead",
      action: "inbound-email-received",
      leadId: processed.leadId,
      conversationId: processed.conversationId
    }).catch(() => undefined);
  }

  return {
    provider: "AWS_SES",
    status: "PROCESSED",
    inboundEmail: toInboundEmailDto(processed)
  };
}

export async function ingestE2ECustomerReply(
  _actor: AuthenticatedUser,
  input: E2ECustomerReplyInput,
  env: NodeJS.ProcessEnv = process.env
): Promise<SesInboundEmailDto> {
  assertE2ELocalInboundEnabled(env);

  const lead = await prisma.lead.findUnique({
    where: { id: input.leadId },
    include: { company: true, contact: true }
  });
  if (!lead) {
    throw new AppError(404, "NOT_FOUND", "Lead not found");
  }
  if (isForbiddenLeadStatus(lead.status)) {
    throw new AppError(409, "CONFLICT", `Lead status ${lead.status} forbids reply processing`);
  }
  if (!lead.contact.email || !lead.contact.normalizedEmail) {
    throw new AppError(409, "CONFLICT", "Lead contact does not have a usable email address");
  }

  const config = getE2EInboundSigningConfig(env);
  const now = new Date().toISOString();
  const providerMessageId = `e2e-customer-reply-${crypto.randomUUID()}@local.shilabs`;
  const subject = input.subject ?? `Re: ${lead.company.name}`;
  const payload: SesInboundNotification = {
    notificationType: "Received",
    mail: {
      messageId: providerMessageId,
      timestamp: now,
      source: lead.contact.email,
      destination: [config.fromEmail],
      commonHeaders: {
        from: [lead.contact.email],
        to: [config.fromEmail],
        subject,
        date: now
      },
      headers: [
        { name: "X-Shilabs-Lead-Id", value: lead.id },
        { name: "From", value: lead.contact.email },
        { name: "To", value: config.fromEmail },
        { name: "Subject", value: subject }
      ]
    },
    receipt: { action: { type: "E2E_LOCAL" } },
    textBody: input.body
  };
  const rawBody = JSON.stringify(payload);

  return ingestSesInboundEmail({
    body: payload,
    rawBody,
    headers: signInboundPayload(rawBody, config.webhookSecret),
    env: config.providerEnv
  });
}
