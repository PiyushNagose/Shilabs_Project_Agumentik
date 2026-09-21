import nodemailer, { type Transporter } from "nodemailer";
import type { MailpitEmailConfig } from "../../../config/email-provider.js";
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

function buildTransport(config: MailpitEmailConfig): Transporter {
  return nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    connectionTimeout: config.timeoutMs,
    greetingTimeout: config.timeoutMs,
    socketTimeout: config.timeoutMs
  });
}

export class MailpitEmailProvider implements EmailProvider {
  private readonly transport: Transporter;

  public constructor(
    private readonly config: MailpitEmailConfig,
    transport?: Transporter
  ) {
    this.transport = transport ?? buildTransport(config);
  }

  public async verifyConnection(): Promise<EmailHealthResult> {
    await this.withTimeout(this.transport.verify(), "Mailpit SMTP health check failed");
    return { provider: "MAILPIT", sendingEnabled: true };
  }

  public async sendEmail(input: EmailSendInput): Promise<EmailSendResult> {
    const response = await this.withTimeout(
      this.transport.sendMail({
        from: input.from,
        to: input.to,
        replyTo: input.replyTo ?? undefined,
        subject: input.subject,
        text: input.textBody ?? undefined,
        html: input.htmlBody ?? undefined,
        headers: {
          "X-Shilabs-Idempotency-Key": input.idempotencyKey
        }
      }),
      "Mailpit SMTP send failed"
    );

    const providerMessageId =
      typeof response.messageId === "string" && response.messageId.trim()
        ? response.messageId
        : undefined;
    if (!providerMessageId) {
      throw providerError("Mailpit accepted no message identifier");
    }

    return {
      provider: "MAILPIT",
      providerMessageId
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
        throw providerError(`${failureMessage}: ${error.message}`);
      }
      throw providerError(failureMessage);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }
}
