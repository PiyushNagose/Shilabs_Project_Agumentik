export type EmailProviderName = "AWS_SES" | "MAILPIT";

export interface EmailSendInput {
  to: string;
  from: string;
  replyTo?: string | null;
  subject: string;
  textBody?: string | null;
  htmlBody?: string | null;
  configurationSet?: string | null;
  idempotencyKey: string;
}

export interface EmailSendResult {
  provider: EmailProviderName;
  providerMessageId: string;
}

export interface EmailHealthResult {
  provider: EmailProviderName;
  sendingEnabled: boolean;
}

export interface EmailProvider {
  verifyConnection(): Promise<EmailHealthResult>;
  sendEmail(input: EmailSendInput): Promise<EmailSendResult>;
}
