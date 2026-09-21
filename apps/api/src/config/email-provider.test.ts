import { describe, expect, it } from "vitest";
import { getSelectedEmailProviderConfig } from "./email-provider.js";

describe("selected email provider config", () => {
  it("selects local Mailpit with localhost SMTP settings", () => {
    const config = getSelectedEmailProviderConfig({
      NODE_ENV: "development",
      EMAIL_PROVIDER: "MAILPIT",
      MAILPIT_SMTP_HOST: "localhost",
      MAILPIT_SMTP_PORT: "1025",
      MAILPIT_FROM_EMAIL: "sales@shilabs.local"
    });

    expect(config).toMatchObject({
      provider: "MAILPIT",
      status: "CONFIGURED",
      host: "localhost",
      port: 1025,
      fromEmail: "sales@shilabs.local"
    });
  });

  it("prevents Mailpit selection in production", () => {
    const config = getSelectedEmailProviderConfig({
      NODE_ENV: "production",
      EMAIL_PROVIDER: "MAILPIT",
      MAILPIT_SMTP_HOST: "localhost",
      MAILPIT_FROM_EMAIL: "sales@shilabs.local"
    });

    expect(config.status).toBe("NOT_CONFIGURED");
    expect(config.missing).toContain("MAILPIT_DISABLED_IN_PRODUCTION");
  });

  it("prevents configured AWS SES usage in development without explicit opt-in", () => {
    const config = getSelectedEmailProviderConfig({
      NODE_ENV: "development",
      EMAIL_PROVIDER: "AWS_SES",
      AWS_SES_REGION: "us-east-1",
      AWS_SES_FROM_EMAIL: "sales@example.com",
      AWS_SES_ACCESS_KEY_ID: "access-key",
      AWS_SES_SECRET_ACCESS_KEY: "secret-key",
      AWS_SES_WEBHOOK_SECRET: "webhook-secret"
    });

    expect(config.provider).toBe("AWS_SES");
    expect(config.status).toBe("NOT_CONFIGURED");
    expect(config.missing).toContain("ALLOW_EXTERNAL_EMAIL_IN_NON_PRODUCTION");
  });
});
