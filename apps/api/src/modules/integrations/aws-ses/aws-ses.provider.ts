import {
  GetAccountCommand,
  SESv2Client,
  SendEmailCommand,
  type SESv2ClientConfig
} from "@aws-sdk/client-sesv2";
import type { AwsSesConfiguredConfig } from "../../../config/aws-ses.js";
import { AppError } from "../../../shared/errors.js";
import type {
  EmailHealthResult,
  EmailProvider,
  EmailSendInput,
  EmailSendResult
} from "../../email/email.provider.js";

function providerError(message: string, retryable = false): AppError {
  return new AppError(
    retryable ? 503 : 502,
    retryable ? "RETRYABLE_PROVIDER_ERROR" : "PROVIDER_ERROR",
    message
  );
}

function buildSesClientConfig(config: AwsSesConfiguredConfig): SESv2ClientConfig {
  return {
    region: config.region,
    maxAttempts: config.maxRetries + 1,
    credentials:
      config.accessKeyId && config.secretAccessKey
        ? {
            accessKeyId: config.accessKeyId,
            secretAccessKey: config.secretAccessKey
          }
        : undefined
  };
}

export class AwsSesProvider implements EmailProvider {
  private readonly client: SESv2Client;

  public constructor(private readonly config: AwsSesConfiguredConfig, client?: SESv2Client) {
    this.client = client ?? new SESv2Client(buildSesClientConfig(config));
  }

  public async verifyConnection(): Promise<EmailHealthResult> {
    const account = await this.withTimeout(
      this.client.send(new GetAccountCommand({})),
      "AWS SES health check failed"
    );

    return {
      provider: "AWS_SES",
      sendingEnabled: account.SendingEnabled ?? false
    };
  }

  public async sendEmail(input: EmailSendInput): Promise<EmailSendResult> {
    const response = await this.withTimeout(
      this.client.send(
        new SendEmailCommand({
          FromEmailAddress: input.from,
          Destination: {
            ToAddresses: [input.to]
          },
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
              Subject: {
                Data: input.subject,
                Charset: "UTF-8"
              },
              Body: {
                Text: input.textBody
                  ? {
                      Data: input.textBody,
                      Charset: "UTF-8"
                    }
                  : undefined,
                Html: input.htmlBody
                  ? {
                      Data: input.htmlBody,
                      Charset: "UTF-8"
                    }
                  : undefined
              }
            }
          }
        })
      ),
      "AWS SES send failed"
    );

    if (!response.MessageId) {
      throw providerError("AWS SES accepted no message identifier");
    }

    return {
      provider: "AWS_SES",
      providerMessageId: response.MessageId
    };
  }

  private async withTimeout<T>(operation: Promise<T>, failureMessage: string): Promise<T> {
    let timeout: NodeJS.Timeout | undefined;
    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => {
        reject(providerError(`${failureMessage}: timeout`, true));
      }, this.config.timeoutMs);
    });

    try {
      return await Promise.race([operation, timeoutPromise]);
    } catch (error) {
      if (error instanceof AppError) throw error;
      if (error instanceof Error) {
        throw providerError(`${failureMessage}: ${error.name}`);
      }
      throw providerError(failureMessage);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }
}
