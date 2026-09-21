import { ZohoBiginAuthClient, type FetchTransport } from "./zoho-bigin.client.js";

const config = {
  status: "CONFIGURED" as const,
  clientId: "client-id",
  clientSecret: "client-secret",
  refreshToken: "refresh-token",
  accountsUrl: "https://accounts.zoho.com",
  apiDomain: "https://www.zohoapis.com",
  requiredScopes: ["ZohoBigin.modules.ALL"],
  timeoutMs: 1000,
  maxRetries: 1,
  tokenSkewSeconds: 120,
  contactsModule: "Contacts",
  dealsModule: "Pipelines",
  timelineRelatedModule: "Contacts",
  syncPerPage: 200,
  syncMaxPages: 2
};

function tokenResponse(scope = "ZohoBigin.modules.ALL"): Response {
  return Response.json({
    access_token: "access-token",
    api_domain: "https://www.zohoapis.com",
    token_type: "Bearer",
    expires_in: 3600,
    scope
  });
}

describe("ZohoBiginAuthClient", () => {
  it("refreshes an OAuth token, validates scopes and verifies API connectivity", async () => {
    const transport = vi
      .fn<FetchTransport>()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(Response.json({ data: [] }));
    const client = new ZohoBiginAuthClient(config, transport);

    const token = await client.verifyConnection();

    expect(token.accessToken).toBe("access-token");
    expect(transport).toHaveBeenCalledTimes(2);
    expect(transport.mock.calls[0]?.[0]).toBe("https://accounts.zoho.com/oauth/v2/token");
    expect(transport.mock.calls[1]?.[0]).toBe(
      "https://www.zohoapis.com/bigin/v2/Contacts?fields=Last_Name,Email&per_page=1"
    );
    expect(JSON.stringify(transport.mock.calls)).not.toContain(config.clientSecret);
    expect(JSON.stringify(transport.mock.calls)).not.toContain(config.refreshToken);
  });

  it("reads one page of Zoho contacts with required CRM identity", async () => {
    const transport = vi
      .fn<FetchTransport>()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(
        Response.json({
          data: [
            {
              id: "r3-zoho-contact-1",
              First_Name: "Priya",
              Last_Name: "Nair",
              Email: "Priya@Example.com",
              Phone: "+91 98765 43210",
              Lead_Source: "Website",
              Modified_Time: "2026-09-15T10:00:00+05:30",
              Account_Name: {
                id: "r3-zoho-account-1",
                name: "R3 Account"
              }
            }
          ],
          info: { more_records: false }
        })
      );
    const client = new ZohoBiginAuthClient(config, transport);

    await expect(client.listContactsPage({ page: 1, perPage: 200 })).resolves.toMatchObject({
      moreRecords: false,
      records: [
        {
          externalRecordId: "r3-zoho-contact-1",
          firstName: "Priya",
          lastName: "Nair",
          email: "Priya@Example.com",
          company: {
            externalRecordId: "r3-zoho-account-1",
            name: "R3 Account"
          }
        }
      ]
    });
  });

  it("reads one page of Zoho deals with related contact identity", async () => {
    const transport = vi
      .fn<FetchTransport>()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(
        Response.json({
          data: [
            {
              id: "r4-zoho-deal-1",
              Deal_Name: "Website Redesign",
              Amount: "25000",
              Currency: "INR",
              Stage: "Qualified",
              Probability: 50,
              Modified_Time: "2026-09-15T10:00:00+05:30",
              Contact_Name: {
                id: "r4-zoho-contact-1",
                name: "Priya Nair"
              }
            }
          ],
          info: { more_records: false }
        })
      );
    const client = new ZohoBiginAuthClient(config, transport);

    await expect(client.listDealsPage({ page: 1, perPage: 200 })).resolves.toMatchObject({
      moreRecords: false,
      records: [
        {
          externalRecordId: "r4-zoho-deal-1",
          relatedLeadExternalRecordId: "r4-zoho-contact-1",
          name: "Website Redesign",
          stageName: "Qualified",
          value: "25000"
        }
      ]
    });
  });

  it("appends a timeline note only when Zoho returns a created record id", async () => {
    const transport = vi
      .fn<FetchTransport>()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(
        Response.json({
          data: [
            {
              status: "success",
              details: { id: "r4-zoho-note-1" }
            }
          ]
        })
      );
    const client = new ZohoBiginAuthClient(config, transport);

    await expect(
      client.appendTimelineEvent({
        localEntityId: "activity-1",
        relatedExternalRecordId: "r4-zoho-contact-1",
        eventType: "NOTE_ADDED",
        occurredAt: new Date("2026-09-15T10:00:00.000Z"),
        title: "Shilabs note",
        description: "Confirmed action",
        idempotencyKey: "r4-note-1"
      })
    ).resolves.toMatchObject({
      entityType: "ACTIVITY",
      externalRecordId: "r4-zoho-note-1"
    });
  });

  it("rejects token responses that do not include required scopes", async () => {
    const transport = vi
      .fn<FetchTransport>()
      .mockResolvedValue(tokenResponse("ZohoBigin.users.READ"));
    const client = new ZohoBiginAuthClient(config, transport);

    await expect(client.getAccessToken(true)).rejects.toMatchObject({
      code: "PROVIDER_ERROR",
      message: "Zoho Bigin token is missing required scopes"
    });
  });

  it("retries transient OAuth failures before succeeding", async () => {
    const transport = vi
      .fn<FetchTransport>()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(tokenResponse());
    const client = new ZohoBiginAuthClient(config, transport);

    await expect(client.getAccessToken(true)).resolves.toMatchObject({
      accessToken: "access-token"
    });
    expect(transport).toHaveBeenCalledTimes(2);
  });

  it("surfaces provider auth errors without returning fake tokens", async () => {
    const transport = vi.fn<FetchTransport>().mockResolvedValue(
      Response.json({
        error: "invalid_client",
        error_description: "invalid client"
      })
    );
    const client = new ZohoBiginAuthClient(config, transport);

    await expect(client.getAccessToken(true)).rejects.toEqual(
      expect.objectContaining({
        code: "PROVIDER_ERROR",
        message: "Zoho Bigin OAuth error: invalid_client"
      })
    );
  });
});
