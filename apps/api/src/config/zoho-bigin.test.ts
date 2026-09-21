import { getZohoBiginConfig } from "./zoho-bigin.js";

const configuredEnv = {
  ZOHO_BIGIN_CLIENT_ID: "client-id",
  ZOHO_BIGIN_CLIENT_SECRET: "client-secret",
  ZOHO_BIGIN_REFRESH_TOKEN: "refresh-token",
  ZOHO_BIGIN_ACCOUNTS_URL: "https://accounts.zoho.com",
  ZOHO_BIGIN_API_DOMAIN: "https://www.zohoapis.com",
  ZOHO_BIGIN_REQUIRED_SCOPES: "ZohoBigin.modules.contacts.READ,ZohoBigin.modules.pipelines.READ",
  ZOHO_BIGIN_TIMEOUT_MS: "1000",
  ZOHO_BIGIN_MAX_RETRIES: "1",
  ZOHO_BIGIN_TOKEN_SKEW_SECONDS: "60",
  ZOHO_BIGIN_CONTACTS_MODULE: "Contacts",
  ZOHO_BIGIN_SYNC_PER_PAGE: "100",
  ZOHO_BIGIN_SYNC_MAX_PAGES: "2"
};

describe("Zoho Bigin configuration", () => {
  it("returns NOT_CONFIGURED with missing credential keys", () => {
    const config = getZohoBiginConfig({});

    expect(config.status).toBe("NOT_CONFIGURED");
    if (config.status !== "NOT_CONFIGURED") throw new Error("Expected missing config");
    expect(config.missing).toEqual([
      "ZOHO_BIGIN_CLIENT_ID",
      "ZOHO_BIGIN_CLIENT_SECRET",
      "ZOHO_BIGIN_REFRESH_TOKEN"
    ]);
  });

  it("parses configured OAuth settings and required scopes", () => {
    const config = getZohoBiginConfig(configuredEnv);

    expect(config.status).toBe("CONFIGURED");
    if (config.status !== "CONFIGURED") throw new Error("Expected configured config");
    expect(config.requiredScopes).toEqual([
      "ZohoBigin.modules.contacts.READ",
      "ZohoBigin.modules.pipelines.READ"
    ]);
    expect(config.contactsModule).toBe("Contacts");
    expect(config.syncPerPage).toBe(100);
    expect(config.syncMaxPages).toBe(2);
    expect(config.clientSecret).toBe("client-secret");
  });
});
