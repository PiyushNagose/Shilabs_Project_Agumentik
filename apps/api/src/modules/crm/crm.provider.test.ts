import type {
  CRMProvider,
  CRMContact,
  CRMDeal,
  CRMLead,
  CRMLeadUpsert,
  CRMContactUpsert,
  CRMDealUpsert,
  CRMTimelineEvent,
  CRMMeetingUpsert,
  ExternalRecordRef,
  VerifiedWebhook,
  WebhookRequest
} from "./crm.provider.js";

class TestCRMProvider implements CRMProvider {
  public listContacts(): Promise<{ records: CRMContact[]; moreRecords: boolean }> {
    return Promise.resolve({
      moreRecords: false,
      records: [
        {
          externalRecordId: "zoho-contact-1",
          firstName: "Test",
          lastName: "Lead",
          email: "lead@example.local",
          company: {
            externalRecordId: "zoho-account-1",
            name: "Test Account"
          }
        }
      ]
    });
  }

  public listDeals(): Promise<{ records: CRMDeal[]; moreRecords: boolean }> {
    return Promise.resolve({
      moreRecords: false,
      records: [
        {
          externalRecordId: "zoho-deal-1",
          relatedLeadExternalRecordId: "zoho-contact-1",
          name: "Test Deal"
        }
      ]
    });
  }

  public pullLead(externalId: string): Promise<CRMLead> {
    return Promise.resolve({
      externalRecordId: externalId,
      fullName: "Test Lead",
      email: "lead@example.local"
    });
  }

  public upsertLead(input: CRMLeadUpsert): Promise<ExternalRecordRef> {
    return Promise.resolve(this.ref("LEAD", input.externalRecordId ?? input.localEntityId));
  }

  public upsertContact(input: CRMContactUpsert): Promise<ExternalRecordRef> {
    return Promise.resolve(this.ref("CONTACT", input.externalRecordId ?? input.localEntityId));
  }

  public upsertDeal(input: CRMDealUpsert): Promise<ExternalRecordRef> {
    return Promise.resolve(this.ref("DEAL", input.externalRecordId ?? input.localEntityId));
  }

  public appendTimelineEvent(input: CRMTimelineEvent): Promise<ExternalRecordRef> {
    return Promise.resolve(this.ref("ACTIVITY", input.idempotencyKey));
  }

  public upsertMeeting(input: CRMMeetingUpsert): Promise<ExternalRecordRef> {
    return Promise.resolve(this.ref("MEETING", input.externalRecordId ?? input.localEntityId));
  }

  public verifyWebhook(input: WebhookRequest): Promise<VerifiedWebhook> {
    return Promise.resolve({
      provider: "ZOHO_BIGIN",
      eventId: "event-1",
      eventType: "lead.updated",
      entityType: "LEAD",
      externalRecordId: "zoho-lead-1",
      occurredAt: input.receivedAt,
      payload: { id: "zoho-lead-1" }
    });
  }

  private ref(entityType: ExternalRecordRef["entityType"], externalRecordId: string) {
    return {
      provider: "ZOHO_BIGIN" as const,
      entityType,
      externalRecordId
    };
  }
}

describe("CRMProvider contract", () => {
  it("allows explicit test doubles without implementing a fake production provider", async () => {
    const provider: CRMProvider = new TestCRMProvider();

    await expect(provider.pullLead("zoho-lead-1")).resolves.toMatchObject({
      externalRecordId: "zoho-lead-1"
    });
    await expect(provider.listContacts({ page: 1, perPage: 200 })).resolves.toMatchObject({
      moreRecords: false,
      records: [{ externalRecordId: "zoho-contact-1" }]
    });
    await expect(provider.listDeals({ page: 1, perPage: 200 })).resolves.toMatchObject({
      moreRecords: false,
      records: [{ externalRecordId: "zoho-deal-1" }]
    });
    await expect(
      provider.upsertLead({ localEntityId: "lead-1", source: "ZOHO_BIGIN" })
    ).resolves.toMatchObject({
      provider: "ZOHO_BIGIN",
      entityType: "LEAD",
      externalRecordId: "lead-1"
    });
  });
});
