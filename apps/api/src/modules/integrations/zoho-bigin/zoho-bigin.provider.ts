import type {
  CRMContact,
  CRMDeal,
  CRMLead,
  CRMProvider,
  ExternalRecordRef,
  VerifiedWebhook
} from "../../crm/crm.provider.js";
import { AppError } from "../../../shared/errors.js";
import type { ZohoBiginAuthClient, ZohoBiginToken } from "./zoho-bigin.client.js";

function syncNotImplemented(): AppError {
  return new AppError(501, "PROVIDER_ERROR", "Zoho Bigin record synchronization starts in R3");
}

export class ZohoBiginProvider implements CRMProvider {
  public constructor(private readonly authClient: ZohoBiginAuthClient) {}

  public verifyConnection(): Promise<ZohoBiginToken> {
    return this.authClient.verifyConnection();
  }

  public listContacts(input: {
    page: number;
    perPage: number;
  }): Promise<{ records: CRMContact[]; moreRecords: boolean }> {
    return this.authClient.listContactsPage(input);
  }

  public listDeals(input: {
    page: number;
    perPage: number;
  }): Promise<{ records: CRMDeal[]; moreRecords: boolean }> {
    return this.authClient.listDealsPage(input);
  }

  public pullLead(): Promise<CRMLead> {
    return Promise.reject(syncNotImplemented());
  }

  public upsertLead(): Promise<ExternalRecordRef> {
    return Promise.reject(syncNotImplemented());
  }

  public upsertContact(): Promise<ExternalRecordRef> {
    return Promise.reject(syncNotImplemented());
  }

  public upsertDeal(): Promise<ExternalRecordRef> {
    return Promise.reject(syncNotImplemented());
  }

  public appendTimelineEvent(
    input: Parameters<CRMProvider["appendTimelineEvent"]>[0]
  ): Promise<ExternalRecordRef> {
    return this.authClient.appendTimelineEvent(input);
  }

  public upsertMeeting(): Promise<ExternalRecordRef> {
    return Promise.reject(syncNotImplemented());
  }

  public verifyWebhook(): Promise<VerifiedWebhook> {
    return Promise.reject(syncNotImplemented());
  }
}
