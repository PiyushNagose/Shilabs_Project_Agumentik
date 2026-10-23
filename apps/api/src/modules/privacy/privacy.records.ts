import { Prisma } from "@prisma/client";
import type { PrivacyCategory } from "./privacy.schemas.js";

export type Filter = Record<string, unknown>;
export interface RecordDelegate {
  findMany(args: { where: Filter; select?: Record<string, boolean>; take?: number; orderBy?: Filter }): Promise<Record<string, unknown>[]>;
  updateMany(args: { where: Filter; data: Filter }): Promise<{ count: number }>;
}
export interface PrivacyRule {
  model: string;
  category: PrivacyCategory;
  path: string;
  fields: string[];
  eligible?: Filter;
}
function rule(model: string, category: PrivacyCategory, path: string, fields: string, eligible?: Filter): PrivacyRule {
  return { model, category, path, fields: fields.split(" "), eligible };
}
// Paths are reviewed tenant boundaries. Metadata is used only to type redaction values.
export const rules: PrivacyRule[] = [
  rule("OutboundEmail", "email", "lead", "subject textBody htmlBody attachmentMetadata failureMessage", { status: { notIn: ["PENDING"] } }),
  rule("InboundEmail", "email", "lead", "subject textBody htmlBody attachmentMetadata rawProviderPayload failureMessage", { processedAt: { not: null } }),
  rule("Message", "messages", "conversation.lead", "body metadata attachmentMetadata", { deliveryStatus: { not: "PENDING" } }),
  rule("OutboundWhatsAppMessage", "messages", "lead", "textBody mediaMetadata failureMessage zohoLastError", { status: { notIn: ["PENDING", "PROVIDER_PENDING"] } }),
  rule("VoiceCallAttempt", "calls", "lead", "transcriptText transcriptUrl recordingUrl failureMessage", { completedAt: { not: null } }),
  rule("VoiceConversationRun", "calls", "lead", "transcriptText outcome summary failureMessage", { status: { not: "STARTED" } }),
  rule("EmailProviderEvent", "providerPayloads", "", "payload", { processedAt: { not: null } }),
  rule("WhatsAppProviderEvent", "providerPayloads", "", "payload failureMessage", { processedAt: { not: null } }),
  rule("VoiceProviderEvent", "providerPayloads", "", "payload", { processedAt: { not: null } }),
  rule("ReplyProcessingRun", "ai", "lead", "inputContext output summary draftResponse failureMessage"),
  rule("ProposalGenerationRun", "ai", "lead", "inputContext approvedKnowledge toolEvidence aiOutput missingFields failureMessage"),
  rule("BriefingRun", "ai", "lead", "inputContext evidence approvedKnowledge output summary recommendedNextAction failureMessage"),
  rule("LeadScoreRun", "ai", "lead", "factors qualificationSnapshot reason failureMessage"),
  rule("LeadIntelligence", "ai", "lead", "summary primaryNeed objections commitments nextObjective communicationStyle contextSnapshot evidence"),
  rule("LeadIntelligenceDecision", "ai", "lead", "reason nextObjective factors evidence"),
  rule("AgentCorrection", "ai", "lead", "previousOutput correctedOutcome correctionSummary"),
  rule("AgentExecution", "ai", "", "summary result evaluation", { status: { in: ["SUCCEEDED", "FAILED", "CANCELED"] } }),
  rule("WorkflowExecution", "ai", "lead", "input result failureMessage", { status: { in: ["SUCCEEDED", "FAILED", "CANCELED"] } }),
  rule("WorkflowStepExecution", "ai", "execution.lead", "input output failureMessage", { status: { in: ["SUCCEEDED", "FAILED", "SKIPPED", "CANCELED"] } }),
  rule("LeadDocumentChunk", "files", "document.lead", "content"),
  rule("LeadDocument", "files", "lead", "title sourceUrl extractedText checksum failureMessage"),
  rule("AuditEvent", "audit", "", "before after metadata"),
  rule("Activity", "audit", "lead", "title description metadata"),
  rule("DomainEventOutbox", "providerPayloads", "", "payload lastErrorMessage", { status: { in: ["PROCESSED", "ATTENTION_REQUIRED"] } }),
  rule("IntegrationSyncRun", "providerPayloads", "", "lastError", { finishedAt: { not: null } }),
  rule("InboundEmail", "providerPayloads", "lead", "rawProviderPayload", { processedAt: { not: null } }),
  rule("OutboundEmail", "files", "lead", "attachmentMetadata", { status: { not: "PENDING" } }),
  rule("InboundEmail", "files", "lead", "attachmentMetadata", { processedAt: { not: null } }),
  rule("Message", "files", "conversation.lead", "attachmentMetadata", { deliveryStatus: { not: "PENDING" } }),
  rule("OutboundWhatsAppMessage", "files", "lead", "mediaMetadata", { status: { notIn: ["PENDING", "PROVIDER_PENDING"] } }),
  rule("FollowUpAttempt", "email", "lead", "subject textBody zohoLastError failureMessage", { status: { notIn: ["SCHEDULED", "SENDING"] } })
];

export const erasureRules: PrivacyRule[] = [
  ...rules,
  rule("Contact", "deletedRecords", "", "firstName lastName title email normalizedEmail phone normalizedPhone whatsappId source preferredChannel"),
  rule("Lead", "deletedRecords", "$lead", "source leadType country priority campaign requirement serviceInterest scoreOverrideReason nextAction"),
  rule("Deal", "deletedRecords", "lead", "wonReason lostReason"),
  rule("Order", "deletedRecords", "", "notes"),
  rule("OrderItem", "deletedRecords", "order", "name description"),
  rule("Proposal", "deletedRecords", "lead", "title serviceType zohoTimelineLastError"),
  rule("ProposalVersion", "deletedRecords", "proposal.lead", "title content editSummary"),
  rule("ProposalStatusChange", "deletedRecords", "proposal.lead", "reason"),
  rule("LeadQualification", "deletedRecords", "lead", "need requirement budget budgetBand authority timeline businessFit urgency"),
  rule("LeadQualificationEvidence", "deletedRecords", "qualification.lead", "quote"),
  rule("Task", "deletedRecords", "lead", "title description metadata"),
  rule("InternalNotification", "deletedRecords", "lead", "title body escalationReason escalationEvidence"),
  rule("MeetingRequest", "deletedRecords", "lead", "title description providerMeetingUrl providerOrganizerEmail providerLastError zohoLastError partyNotificationNote"),
  rule("HumanTakeover", "deletedRecords", "lead", "reason"),
  rule("NegotiationHandoff", "deletedRecords", "lead", "summary failureMessage"),
  rule("FollowUpSequence", "deletedRecords", "lead", "policyCriteria lastErrorMessage"),
  rule("FollowUpAttempt", "deletedRecords", "lead", "subject textBody failureMessage zohoLastError"),
  rule("CallingSequence", "deletedRecords", "lead", "lastErrorMessage"),
  rule("CallingAttempt", "deletedRecords", "lead", "failureMessage")
];

const models = new Map(Prisma.dmmf.datamodel.models.map((model) => [model.name, model]));
export function modelFields(model: string) {
  const result = models.get(model);
  if (!result) throw new Error(`Unknown privacy model: ${model}`);
  return result.fields;
}
export function delegate(tx: Prisma.TransactionClient, model: string): RecordDelegate {
  const result = (tx as unknown as Record<string, RecordDelegate>)[model.slice(0, 1).toLowerCase() + model.slice(1)];
  if (!result) throw new Error(`Unknown privacy delegate: ${model}`);
  return result;
}
function nested(path: string, where: Filter): Filter {
  return path.split(".").filter(Boolean).reverse().reduce<Filter>((result, key) => ({ [key]: result }), where);
}
export function scope(rule: PrivacyRule, workspaceId: string, contactId?: string): Filter {
  const fields = modelFields(rule.model);
  const conditions: Filter[] = [];
  if (fields.some((field) => field.name === "workspaceId")) conditions.push({ workspaceId });
  if (rule.path) {
    const leaf = { workspaceId, ...(contactId ? { contactId } : {}) };
    const related = rule.path === "$lead" ? leaf : nested(rule.path, leaf);
    const alternatives = [related];
    if (contactId && rule.path !== "$lead" && fields.some((field) => field.name === "contactId") && fields.some((field) => field.name === "workspaceId")) alternatives.push({ contactId });
    if (contactId && rule.model === "AgentCorrection") {
      alternatives.push(nested("proposal.lead", leaf), nested("conversation.lead", leaf), nested("proposalGenerationRun.lead", leaf), nested("replyProcessingRun.lead", leaf));
    }
    conditions.push(alternatives.length === 1 ? related : { OR: alternatives });
  }
  if (contactId && !rule.path) {
    if (rule.model === "Contact") conditions.push({ id: contactId });
    else if (fields.some((field) => field.name === "contactId")) conditions.push({ contactId });
    else return { id: { in: [] } }; // Opaque records require explicit reference matching in the service.
  }
  return { AND: conditions };
}

export function redactionData(rule: PrivacyRule, erase = false): Filter {
  const fields = modelFields(rule.model);
  const names = new Set(rule.fields);
  if (erase) {
    for (const field of fields) {
      if (/^(toEmail|normalizedToEmail|fromEmail|replyToEmail|fromPhone|toPhone|normalizedToPhone|toWhatsAppId|toEmails|ccEmails|fromPhoneNumberId|normalizedFromEmail|threadId|inReplyTo|providerReferences|providerThreadId|recordingProviderId|transcriptProviderId)$/.test(field.name)) names.add(field.name);
    }
  }
  return Object.fromEntries([...names].map((name) => {
    const field = fields.find((item) => item.name === name);
    if (!field) throw new Error(`Unknown privacy field: ${rule.model}.${name}`);
    return [name, field.isList ? [] : field.type === "Json" ? { redacted: true } : field.isRequired ? "[redacted]" : null];
  }));
}

export function contentRemaining(rule: PrivacyRule): Filter {
  const fields = modelFields(rule.model);
  return { OR: rule.fields.map((name) => {
    const field = fields.find((item) => item.name === name);
    if (!field) throw new Error(`Unknown privacy field: ${rule.model}.${name}`);
    if (field.isList) return { [name]: { isEmpty: false } };
    if (field.type === "Json") return { AND: [
      { [name]: { not: { redacted: true } } },
      { [name]: { not: Prisma.DbNull } },
      { [name]: { not: Prisma.JsonNull } }
    ] };
    return { [name]: field.isRequired ? { not: "[redacted]" } : { not: null } };
  }) };
}
