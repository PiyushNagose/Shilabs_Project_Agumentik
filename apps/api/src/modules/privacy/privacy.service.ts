import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../../shared/prisma.js";
import { AppError } from "../../shared/errors.js";
import { redactSecrets } from "../../shared/redaction.js";
import type { AuthenticatedUser } from "../auth/auth.types.js";
import { isWorkspaceAdmin, isWorkspaceManager } from "../authorization/workspace-permissions.js";
import { stopAiInTransaction } from "../leads/lead-automation-ownership.service.js";
import { publishRealtimeEvent } from "../realtime/realtime.service.js";
import { categories, policySchema, type PrivacyPolicyInput } from "./privacy.schemas.js";
import { contentRemaining, delegate, erasureRules, redactionData, rules, scope, type Filter, type PrivacyRule } from "./privacy.records.js";

const transactionOptions = { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 60_000, maxWait: 10_000 };
const cleanupRules = [...rules, ...erasureRules.filter((rule) => rule.category === "deletedRecords")];
const planSchema = z.array(z.object({ rule: z.number().int().min(0).max(cleanupRules.length - 1), ids: z.array(z.string()).max(500), cutoff: z.iso.datetime(), more: z.boolean() }));
type Plan = z.infer<typeof planSchema>;

function cleanupRule(index: number): PrivacyRule {
  const rule = cleanupRules[index];
  if (!rule) throw new AppError(409, "CONFLICT", "Create a fresh cleanup preview");
  return rule;
}

async function notify(workspaceId: string, action: string, entityType: "workspace" | "contact" | "lead" | "conversation" = "workspace"): Promise<void> {
  try { await publishRealtimeEvent({ workspaceId, entityType, action }); }
  catch { console.warn("Privacy update committed; realtime notification unavailable"); }
}

export function privacyWorkspace(actor: AuthenticatedUser, admin = false): string {
  if (!actor.activeWorkspaceId || !(admin ? isWorkspaceAdmin(actor) : isWorkspaceManager(actor))) {
    throw new AppError(403, "AUTHORIZATION_ERROR", admin ? "Workspace administrator access required" : "Workspace manager access required");
  }
  return actor.activeWorkspaceId;
}

async function audit(tx: Prisma.TransactionClient, workspaceId: string, actorId: string | null, action: string, entityId: string, after?: Prisma.InputJsonValue): Promise<void> {
  await tx.auditEvent.create({ data: {
    workspaceId, actorType: actorId ? "USER" : "SYSTEM", actorId, actorUserId: actorId,
    sourceType: "PRIVACY", sourceId: entityId, entityType: "Privacy", entityId, action, after
  } });
}

async function readPolicy(tx: Prisma.TransactionClient, workspaceId: string) {
  const policy = await tx.workspacePrivacyPolicy.findUnique({ where: { workspaceId } });
  return policy ? { enabled: policy.enabled, revision: policy.revision, periods: policySchema.shape.periods.parse(policy.periods) }
    : { enabled: false, revision: 0, periods: {} as PrivacyPolicyInput["periods"] };
}

export async function getPrivacyPolicy(actor: AuthenticatedUser) {
  return readPolicy(prisma, privacyWorkspace(actor));
}

export async function savePrivacyPolicy(actor: AuthenticatedUser, raw: PrivacyPolicyInput) {
  const workspaceId = privacyWorkspace(actor, true);
  const input = policySchema.parse(raw);
  if (input.enabled && !categories.some((key) => input.periods[key] != null)) {
    throw new AppError(422, "VALIDATION_ERROR", "Choose at least one retention period before enabling automatic cleanup");
  }
  const result = await prisma.$transaction(async (tx) => {
    const current = await readPolicy(tx, workspaceId);
    if (current.revision !== input.revision) throw new AppError(409, "CONFLICT", "Privacy settings changed. Reload before saving.");
    const data = { enabled: input.enabled, periods: input.periods, revision: current.revision + 1 };
    await tx.workspacePrivacyPolicy.upsert({ where: { workspaceId }, create: { workspaceId, ...data }, update: data });
    await audit(tx, workspaceId, actor.id, "PRIVACY_POLICY_UPDATED", workspaceId, data);
    return data;
  }, transactionOptions);
  await notify(workspaceId, "privacy-policy-updated");
  return result;
}

function eligible(rule: PrivacyRule, workspaceId: string, cutoff: string): Filter {
  const filters: Filter[] = [scope(rule, workspaceId), { createdAt: { lt: new Date(cutoff) } }, rule.eligible ?? {}, contentRemaining(rule)];
  if (rule.category === "deletedRecords") {
    // Tombstones remain for referential and audit integrity; only residual content is cleaned.
    const contact = { workspaceId, erasedAt: { lt: new Date(cutoff) } };
    if (rule.model === "Contact") filters.push(contact);
    else if (rule.model === "Order") filters.push({ contact });
    else if (rule.model === "OrderItem") filters.push({ order: { contact } });
    else {
      const lead = { workspaceId, contact };
      const path = rule.path === "$lead" ? [] : rule.path.split(".");
      filters.push(path.reverse().reduce<Filter>((result, key) => ({ [key]: result }), lead));
    }
  }
  // Never clear mutable AI state while the owning lead can still run automation.
  if (rule.category === "ai" && rule.path) {
    filters.push(rule.path.split(".").reverse().reduce<Filter>((result, key) => ({ [key]: result }), { automationOwnershipState: "AI_STOPPED" }));
  }
  return { AND: filters };
}

function summary(plan: Plan) {
  return Object.fromEntries(categories.map((category) => [category,
    plan.filter((item) => cleanupRule(item.rule).category === category).reduce((sum, item) => sum + item.ids.length, 0)
  ]));
}

async function previewInTransaction(tx: Prisma.TransactionClient, workspaceId: string, now: Date) {
  const policy = await readPolicy(tx, workspaceId);
  const plan: Plan = [];
  let remaining = 500;
  for (const [index, rule] of cleanupRules.entries()) {
    const days = policy.periods[rule.category];
    if (days == null) continue;
    const cutoff = new Date(now.getTime() - days * 86400000).toISOString();
    const records = await delegate(tx, rule.model).findMany({ where: eligible(rule, workspaceId, cutoff), select: { id: true }, take: remaining + 1, orderBy: { id: "asc" } });
    if (records.length) {
      const ids = records.slice(0, remaining).map((row) => String(row.id));
      plan.push({ rule: index, cutoff, ids, more: records.length > remaining });
      remaining -= ids.length;
    }
  }
  await tx.privacyCleanup.deleteMany({ where: { workspaceId, expiresAt: { lt: now } } });
  const preview = await tx.privacyCleanup.create({ data: { workspaceId, policyRevision: policy.revision, plan, expiresAt: new Date(now.getTime() + 15 * 60000) } });
  return { previewId: preview.id, expiresAt: preview.expiresAt.toISOString(), counts: summary(plan), hasMore: plan.some((item) => item.more) };
}

export async function previewPrivacyCleanup(actor: AuthenticatedUser) {
  const workspaceId = privacyWorkspace(actor, true);
  return prisma.$transaction((tx) => previewInTransaction(tx, workspaceId, new Date()), transactionOptions);
}

async function applyInTransaction(tx: Prisma.TransactionClient, workspaceId: string, previewId: string, actorId: string | null, now: Date) {
  const preview = await tx.privacyCleanup.findFirst({ where: { id: previewId, workspaceId } });
  if (!preview) throw new AppError(404, "NOT_FOUND", "Cleanup preview not found");
  if (preview.appliedAt || preview.expiresAt <= now) throw new AppError(409, "CONFLICT", "Create a fresh cleanup preview");
  const policy = await readPolicy(tx, workspaceId);
  if (policy.revision !== preview.policyRevision) throw new AppError(409, "CONFLICT", "Settings changed. Preview cleanup again.");
  const plan = planSchema.parse(preview.plan);
  let cleaned = 0;
  for (const item of plan) {
    const rule = cleanupRule(item.rule);
    cleaned += (await delegate(tx, rule.model).updateMany({
      where: { AND: [eligible(rule, workspaceId, item.cutoff), { id: { in: item.ids } }] }, data: redactionData(rule)
    })).count;
  }
  await tx.privacyCleanup.update({ where: { id: preview.id }, data: { appliedAt: now, plan: [] } });
  await audit(tx, workspaceId, actorId, "PRIVACY_CONTENT_CLEANED", preview.id, { cleaned });
  return { cleaned };
}

export async function applyPrivacyCleanup(actor: AuthenticatedUser, previewId: string) {
  const workspaceId = privacyWorkspace(actor, true);
  const result = await prisma.$transaction((tx) => applyInTransaction(tx, workspaceId, previewId, actor.id, new Date()), transactionOptions);
  await notify(workspaceId, "privacy-content-cleaned");
  return result;
}

// Worker entry point: one bounded batch per call; no HTTP route or scheduler enables it implicitly.
export async function runWorkspaceRetention(workspaceId: string, now = new Date()) {
  if (!workspaceId) throw new AppError(422, "VALIDATION_ERROR", "Workspace required");
  return prisma.$transaction(async (tx) => {
    const claim = await tx.workspacePrivacyPolicy.updateMany({
      where: { workspaceId, enabled: true, nextRunAt: { lte: now }, workspace: { status: "ACTIVE" } },
      data: { nextRunAt: new Date(now.getTime() + 60 * 60000) }
    });
    if (!claim.count) return { cleaned: 0, skipped: true, hasMore: false };
    const preview = await previewInTransaction(tx, workspaceId, now);
    return { ...await applyInTransaction(tx, workspaceId, preview.previewId, null, now), skipped: false, hasMore: preview.hasMore };
  }, transactionOptions);
}

export async function runDueWorkspaceRetention(now = new Date()) {
  const policies = await prisma.workspacePrivacyPolicy.findMany({
    where: { enabled: true, nextRunAt: { lte: now }, workspace: { status: "ACTIVE" } },
    select: { workspaceId: true }, orderBy: [{ nextRunAt: "asc" }, { workspaceId: "asc" }], take: 5
  });
  const results = [];
  for (const policy of policies) {
    try { results.push({ workspaceId: policy.workspaceId, ...await runWorkspaceRetention(policy.workspaceId, now) }); }
    catch (error) {
      const conflict = error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034";
      results.push({ workspaceId: policy.workspaceId, cleaned: 0, skipped: conflict, failed: !conflict });
    }
  }
  return { results, limit: 5 };
}

async function contactFor(tx: Prisma.TransactionClient, workspaceId: string, contactId: string) {
  const contact = await tx.contact.findFirst({ where: { id: contactId, workspaceId } });
  if (!contact) throw new AppError(404, "NOT_FOUND", "Contact not found");
  // Refuse inconsistent legacy relationships rather than crossing workspace boundaries through stopAi.
  const foreign = await tx.lead.count({ where: { contactId, OR: [{ workspaceId: null }, { workspaceId: { not: workspaceId } }] } });
  if (foreign) throw new AppError(409, "CONFLICT", "Contact has inconsistent workspace links. Repair these before continuing.");
  return contact;
}

const exportFields: Record<string, string[]> = {
  Contact: ["id", "firstName", "lastName", "title", "email", "phone", "doNotContact", "createdAt", "erasedAt"],
  Lead: ["id", "source", "status", "requirement", "serviceInterest", "createdAt"],
  OutboundEmail: ["id", "subject", "textBody", "sentAt", "status"],
  InboundEmail: ["id", "subject", "textBody", "receivedAt"],
  Message: ["id", "body", "direction", "createdAt"],
  OutboundWhatsAppMessage: ["id", "textBody", "sentAt", "status"],
  VoiceCallAttempt: ["id", "transcriptText", "status", "createdAt"],
  VoiceConversationRun: ["id", "transcriptText", "summary", "createdAt"],
  LeadDocument: ["id", "title", "kind", "extractedText", "createdAt"],
  LeadQualification: ["id", "need", "requirement", "budget", "authority", "timeline"],
  ProposalVersion: ["id", "title", "content", "createdAt"],
  Order: ["id", "orderNumber", "paymentStatus", "fulfillmentStatus", "currency", "total", "createdAt"],
  Task: ["id", "title", "description", "status", "createdAt"],
  MeetingRequest: ["id", "title", "description", "status", "createdAt"],
  Activity: ["id", "type", "title", "description", "occurredAt"]
};

export function safeExportValue(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Prisma.Decimal.isDecimal(value)) return value.toString();
  if (typeof value === "string") return redactSecrets(value)
    .replace(/\b(password|secret|token|api[_-]?key|authorization)\s*[:=]\s*[^\s,;]+/gi, "$1=[REDACTED]")
    .replace(/https?:\/\/[^\s<>"']+/gi, "[link omitted]");
  if (Array.isArray(value)) return value.map(safeExportValue);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, safeExportValue(entry)]));
  return value;
}

export async function exportContactData(actor: AuthenticatedUser, contactId: string) {
  const workspaceId = privacyWorkspace(actor);
  return prisma.$transaction(async (tx) => {
    await contactFor(tx, workspaceId, contactId);
    const records: Record<string, unknown> = {};
    for (const [model, fields] of Object.entries(exportFields)) {
      const rule = erasureRules.find((rule) => rule.model === model);
      if (!rule) throw new AppError(500, "INTERNAL_ERROR", "Export configuration unavailable");
      const rows = await delegate(tx, model).findMany({ where: scope(rule, workspaceId, contactId), select: Object.fromEntries(fields.map((field) => [field, true])), take: 10001, orderBy: { id: "asc" } });
      if (rows.length > 10000) throw new AppError(413, "VALIDATION_ERROR", "This contact needs a streamed export. Contact an administrator.");
      records[model] = safeExportValue(rows);
    }
    await audit(tx, workspaceId, actor.id, "CONTACT_DATA_EXPORTED", contactId);
    return { version: 1, exportedAt: new Date().toISOString(), records };
  }, transactionOptions);
}

// Opaque JSON has no relational FK. Match exact stored IDs and personal values within this workspace.
export function privacyTable(name: "AuditEvent" | "DomainEventOutbox" | "EmailProviderEvent" | "VoiceProviderEvent" | "WhatsAppProviderEvent") {
  if (!process.env.DATABASE_URL) throw new AppError(500, "INTERNAL_ERROR", "Database schema configuration unavailable");
  const schema = new URL(process.env.DATABASE_URL).searchParams.get("schema") ?? "public";
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(schema)) throw new AppError(500, "INTERNAL_ERROR", "Invalid database schema configuration");
  return Prisma.raw(`"${schema}"."${name}"`);
}

async function scrubOpaque(tx: Prisma.TransactionClient, workspaceId: string, identifiers: string[]) {
  const matches = (columns: Prisma.Sql) => Prisma.join(identifiers.map((id) => Prisma.sql`strpos(${columns}, ${id}) > 0`), " OR ");
  const auditText = Prisma.sql`concat_ws(' ', "entityId", "sourceId", "before"::text, "after"::text, "metadata"::text)`;
  await tx.$executeRaw(Prisma.sql`UPDATE ${privacyTable("AuditEvent")} SET "before" = '{"redacted":true}'::jsonb, "after" = '{"redacted":true}'::jsonb, "metadata" = '{"redacted":true}'::jsonb WHERE "workspaceId" = ${workspaceId} AND (${matches(auditText)})`);
  const eventText = Prisma.sql`concat_ws(' ', "aggregateId", "payload"::text)`;
  await tx.$executeRaw(Prisma.sql`UPDATE ${privacyTable("DomainEventOutbox")} SET "payload" = '{"redacted":true}'::jsonb, "lastErrorMessage" = NULL, "status" = 'ATTENTION_REQUIRED', "lastErrorCode" = 'PRIVACY_ERASURE' WHERE "workspaceId" = ${workspaceId} AND "status" IN ('PENDING', 'QUEUED', 'PROCESSING', 'FAILED') AND (${matches(eventText)})`);
  await tx.$executeRaw(Prisma.sql`UPDATE ${privacyTable("DomainEventOutbox")} SET "payload" = '{"redacted":true}'::jsonb, "lastErrorMessage" = NULL WHERE "workspaceId" = ${workspaceId} AND (${matches(eventText)})`);
  for (const name of ["EmailProviderEvent", "VoiceProviderEvent", "WhatsAppProviderEvent"] as const) {
    const foreignKey = name === "EmailProviderEvent" ? Prisma.sql`"outboundEmailId"` : name === "VoiceProviderEvent" ? Prisma.sql`"callAttemptId"` : Prisma.sql`"outboundMessageId"`;
    await tx.$executeRaw(Prisma.sql`UPDATE ${privacyTable(name)} SET "payload" = '{"redacted":true}'::jsonb WHERE "workspaceId" = ${workspaceId} AND (${matches(Prisma.sql`concat_ws(' ', ${foreignKey}, "payload"::text)`)})`);
  }
}

export async function eraseContactData(actor: AuthenticatedUser, contactId: string) {
  const workspaceId = privacyWorkspace(actor, true);
  const result = await prisma.$transaction(async (tx) => {
    const contact = await contactFor(tx, workspaceId, contactId);
    const leads = await tx.lead.findMany({ where: { workspaceId, contactId }, select: { id: true } });
    const leadIds = leads.map((lead) => lead.id);
    const activeCalls = await tx.voiceCallAttempt.count({ where: { workspaceId, contactId, status: { in: ["PROVIDER_PENDING", "QUEUED", "RINGING", "IN_PROGRESS"] } } });
    if (activeCalls) throw new AppError(409, "CONFLICT", "Wait for active calls to finish before erasing this contact");
    const activeAgents = await tx.agentExecution.count({ where: { workspaceId, leadId: { in: leadIds }, status: "RUNNING" } });
    const activeWorkflows = await tx.workflowExecution.count({ where: { workspaceId, leadId: { in: leadIds }, status: "RUNNING" } });
    if (activeAgents || activeWorkflows) throw new AppError(409, "CONFLICT", "Wait for active automation to finish before erasing this contact");
    await tx.contact.updateMany({ where: { id: contactId, workspaceId }, data: { doNotContact: true } });
    for (const lead of leads) await stopAiInTransaction({ client: tx, leadId: lead.id, actorType: "USER", actorId: actor.id, reason: "PRIVACY_ERASURE", sourceType: "PRIVACY", sourceId: contactId });
    await tx.agentExecution.updateMany({ where: { workspaceId, leadId: { in: leadIds }, status: { in: ["QUEUED", "WAITING", "RUNNING", "HUMAN_REQUIRED"] } }, data: { status: "CANCELED", completedAt: new Date(), nextRunAt: null } });
    await tx.workflowExecution.updateMany({ where: { workspaceId, leadId: { in: leadIds }, status: "HUMAN_REQUIRED" }, data: { status: "CANCELED", completedAt: new Date() } });
    await tx.outboundEmail.updateMany({ where: { workspaceId, contactId, status: "PENDING" }, data: { status: "BLOCKED", failureCode: "PRIVACY_ERASURE" } });
    await tx.outboundWhatsAppMessage.updateMany({ where: { workspaceId, contactId, status: { in: ["PENDING", "PROVIDER_PENDING"] } }, data: { status: "BLOCKED", failureCode: "PRIVACY_ERASURE" } });
    await tx.voiceCallAttempt.updateMany({ where: { workspaceId, contactId, status: "REQUESTED" }, data: { status: "BLOCKED", failureCode: "PRIVACY_ERASURE" } });
    await tx.leadIntelligence.updateMany({ where: { workspaceId, leadId: { in: leadIds } }, data: { aiControlStatus: "OFF" } });
    await tx.leadDocument.updateMany({ where: { workspaceId, leadId: { in: leadIds } }, data: { status: "ARCHIVED" } });
    const identifiers = [contactId, ...leadIds, contact.email, contact.normalizedEmail, contact.phone, contact.normalizedPhone, contact.whatsappId].filter((id): id is string => Boolean(id));
    let totalRecords = 0;
    for (const rule of erasureRules) {
      const where = scope(rule, workspaceId, contactId);
      const rows = await delegate(tx, rule.model).findMany({ where, select: { id: true }, take: 10001 });
      totalRecords += rows.length;
      if (totalRecords > 10000) throw new AppError(413, "VALIDATION_ERROR", "This contact needs a batched erasure. Contact an administrator.");
      identifiers.push(...rows.map((row) => String(row.id)));
      await delegate(tx, rule.model).updateMany({ where, data: redactionData(rule, true) });
    }
    // Contact-only tasks/orders and agent executions have no mandatory lead relation.
    await tx.task.updateMany({ where: { workspaceId, contactId }, data: { title: "[redacted]", description: null, metadata: { redacted: true }, status: "CANCELED", reminderAt: null } });
    await tx.agentExecution.updateMany({ where: { workspaceId, leadId: { in: leadIds } }, data: { summary: null, result: { redacted: true }, evaluation: { redacted: true } } });
    await scrubOpaque(tx, workspaceId, [...new Set(identifiers)]);
    await tx.contact.updateMany({ where: { id: contactId, workspaceId }, data: { erasedAt: contact.erasedAt ?? new Date(), doNotContact: true } });
    await audit(tx, workspaceId, actor.id, "CONTACT_DATA_ERASED", contactId, { anonymized: true, doNotContact: true });
    return { contactId, anonymized: true, externalCopies: "Provider-held copies require separate deletion through the provider." };
  }, transactionOptions);
  await notify(workspaceId, "contact-data-erased");
  await notify(workspaceId, "contact-data-erased", "contact");
  await notify(workspaceId, "contact-data-erased", "lead");
  await notify(workspaceId, "contact-data-erased", "conversation");
  return result;
}
