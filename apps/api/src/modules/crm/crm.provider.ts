export type CRMEntityType =
  | "COMPANY"
  | "CONTACT"
  | "LEAD"
  | "DEAL"
  | "PIPELINE_STAGE"
  | "ACTIVITY"
  | "MESSAGE"
  | "MEETING"
  | "PROPOSAL";

export interface ExternalRecordRef {
  provider: "ZOHO_BIGIN";
  entityType: CRMEntityType;
  externalRecordId: string;
  externalVersion?: string;
  externalUpdatedAt?: Date;
}

export interface CRMLead {
  externalRecordId: string;
  externalVersion?: string;
  externalUpdatedAt?: Date;
  fullName: string;
  email?: string;
  phone?: string;
  companyName?: string;
  source?: string;
  requirement?: string;
}

export interface CRMCompanyRef {
  externalRecordId: string;
  name: string;
  website?: string;
}

export interface CRMContact {
  externalRecordId: string;
  externalVersion?: string;
  externalUpdatedAt?: Date;
  firstName: string;
  lastName: string;
  title?: string;
  email?: string;
  phone?: string;
  whatsappId?: string;
  source?: string;
  company: CRMCompanyRef;
}

export interface CRMContactUpsert {
  localEntityId: string;
  externalRecordId?: string;
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
  companyExternalRecordId?: string;
}

export interface CRMLeadUpsert {
  localEntityId: string;
  externalRecordId?: string;
  contactExternalRecordId?: string;
  companyExternalRecordId?: string;
  ownerEmail?: string;
  source: string;
  requirement?: string;
  status?: string;
}

export interface CRMDealUpsert {
  localEntityId: string;
  externalRecordId?: string;
  leadExternalRecordId: string;
  name: string;
  value?: string;
  currency?: string;
  stageKey?: string;
  probability?: number;
}

export interface CRMDeal {
  externalRecordId: string;
  externalVersion?: string;
  externalUpdatedAt?: Date;
  relatedLeadExternalRecordId: string;
  name: string;
  stageName?: string;
  value?: string;
  currency?: string;
  probability?: number;
  status?: string;
}

export interface CRMTimelineEvent {
  localEntityId: string;
  relatedExternalRecordId: string;
  eventType: string;
  occurredAt: Date;
  title: string;
  description: string;
  idempotencyKey: string;
}

export interface CRMMeetingUpsert {
  localEntityId: string;
  externalRecordId?: string;
  relatedExternalRecordId: string;
  startsAt: Date;
  endsAt: Date;
  timezone: string;
  subject: string;
  attendees: string[];
}

export interface WebhookRequest {
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
  receivedAt: Date;
}

export interface VerifiedWebhook {
  provider: "ZOHO_BIGIN";
  eventId: string;
  eventType: string;
  entityType: CRMEntityType;
  externalRecordId: string;
  occurredAt: Date;
  payload: unknown;
}

export interface CRMProvider {
  listContacts(input: { page: number; perPage: number }): Promise<{
    records: CRMContact[];
    moreRecords: boolean;
  }>;
  listDeals(input: { page: number; perPage: number }): Promise<{
    records: CRMDeal[];
    moreRecords: boolean;
  }>;
  pullLead(externalId: string): Promise<CRMLead>;
  upsertLead(input: CRMLeadUpsert): Promise<ExternalRecordRef>;
  upsertContact(input: CRMContactUpsert): Promise<ExternalRecordRef>;
  upsertDeal(input: CRMDealUpsert): Promise<ExternalRecordRef>;
  appendTimelineEvent(input: CRMTimelineEvent): Promise<ExternalRecordRef>;
  upsertMeeting(input: CRMMeetingUpsert): Promise<ExternalRecordRef>;
  verifyWebhook(input: WebhookRequest): Promise<VerifiedWebhook>;
}
