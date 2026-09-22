import nodemailer, { type Transporter } from "nodemailer";
import type { WorkerMailpitConfig } from "./email.config.js";
import type { WorkerEmailProvider, WorkerEmailSendInput } from "./aws-ses.provider.js";

function buildTransport(config: WorkerMailpitConfig): Transporter {
  return nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    connectionTimeout: config.timeoutMs,
    greetingTimeout: config.timeoutMs,
    socketTimeout: config.timeoutMs
  });
}

export class WorkerMailpitProvider implements WorkerEmailProvider {
  private readonly transport: Transporter;

  public constructor(
    private readonly config: WorkerMailpitConfig,
    transport?: Transporter
  ) {
    this.transport = transport ?? buildTransport(config);
  }

  public async sendEmail(input: WorkerEmailSendInput): Promise<{ providerMessageId: string }> {
    let timeout: NodeJS.Timeout | undefined;
    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(
        () => reject(new Error("Mailpit SMTP send timed out")),
        this.config.timeoutMs
      );
    });

    try {
      const response = await Promise.race([
        this.transport.sendMail({
          from: input.from,
          to: input.to,
          replyTo: input.replyTo ?? undefined,
          subject: input.subject,
          text: input.textBody,
          headers: {
            "X-Shilabs-Idempotency-Key": input.idempotencyKey
          }
        }),
        timeoutPromise
      ]);
      const providerMessageId =
        typeof response.messageId === "string" && response.messageId.trim()
          ? response.messageId
          : undefined;
      if (!providerMessageId) throw new Error("Mailpit accepted no message identifier");
      return { providerMessageId };
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }
}
