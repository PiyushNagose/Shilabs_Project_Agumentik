import {
  SESv2Client,
  SendEmailCommand,
  type SESv2ClientConfig
} from "@aws-sdk/client-sesv2";
import type { WorkerAwsSesConfig } from "./aws-ses.config.js";

export interface WorkerEmailSendInput {
  to: string;
  from: string;
  replyTo?: string | null;
  subject: string;
  textBody: string;
  configurationSet?: string | null;
  idempotencyKey: string;
}

export interface WorkerEmailProvider {
  sendEmail(input: WorkerEmailSendInput): Promise<{ providerMessageId: string }>;
}

function clientConfig(config: WorkerAwsSesConfig): SESv2ClientConfig {
  return {
    region: config.region,
    maxAttempts: config.maxRetries + 1,
    credentials:
      config.accessKeyId && config.secretAccessKey
        ? { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey }
        : undefined
  };
}

export class WorkerAwsSesProvider implements WorkerEmailProvider {
  private readonly client: SESv2Client;

  public constructor(
    private readonly config: WorkerAwsSesConfig,
    client?: SESv2Client
  ) {
    this.client = client ?? new SESv2Client(clientConfig(config));
  }

  public async sendEmail(input: WorkerEmailSendInput): Promise<{ providerMessageId: string }> {
    let timeout: NodeJS.Timeout | undefined;
    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => reject(new Error("AWS SES send timed out")), this.config.timeoutMs);
    });
    try {
      const response = await Promise.race([
        this.client.send(
          new SendEmailCommand({
            FromEmailAddress: input.from,
            Destination: { ToAddresses: [input.to] },
            ReplyToAddresses: input.replyTo ? [input.replyTo] : undefined,
            ConfigurationSetName: input.configurationSet ?? undefined,
            EmailTags: [
              {
                Name: "shilabs-idempotency-key",
                Value: input.idempotencyKey.slice(0, 256)
              }
            ],
            Content: {
              Simple: {
                Subject: { Data: input.subject, Charset: "UTF-8" },
                Body: { Text: { Data: input.textBody, Charset: "UTF-8" } }
              }
            }
          })
        ),
        timeoutPromise
      ]);
      if (!response.MessageId) throw new Error("AWS SES accepted no message identifier");
      return { providerMessageId: response.MessageId };
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }
}
