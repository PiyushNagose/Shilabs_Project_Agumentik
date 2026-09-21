import { describe, expect, it } from "vitest";
import { getAwsSesConfig } from "./aws-ses.js";

describe("AWS SES configuration", () => {
  it("truthfully reports NOT_CONFIGURED when required values are missing", () => {
    const config = getAwsSesConfig({});

    expect(config.status).toBe("NOT_CONFIGURED");
    expect(config.missing).toEqual([
      "AWS_SES_REGION",
      "AWS_SES_FROM_EMAIL",
      "AWS_SES_WEBHOOK_SECRET",
      "AWS_SES_ACCESS_KEY_ID",
      "AWS_SES_SECRET_ACCESS_KEY"
    ]);
  });

  it("allows explicit default credential chain usage without plaintext access keys", () => {
    const config = getAwsSesConfig({
      AWS_SES_REGION: "us-east-1",
      AWS_SES_FROM_EMAIL: "sales@example.com",
      AWS_SES_WEBHOOK_SECRET: "local-test-secret",
      AWS_SES_USE_DEFAULT_CREDENTIAL_CHAIN: "true"
    });

    expect(config.status).toBe("CONFIGURED");
    expect(config.useDefaultCredentialChain).toBe(true);
    expect(config.missing).toEqual([]);
  });
});
