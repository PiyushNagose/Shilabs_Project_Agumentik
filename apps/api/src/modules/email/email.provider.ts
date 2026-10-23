export type EmailProviderName = "AWS_SES" | "MAILPIT";

export interface EmailSendInput {
  to: string;
  cc?: string[];
  from: string;
  replyTo?: string | null;
  subject: string;
  textBody?: string | null;
  htmlBody?: string | null;
  attachments?: {
    fileName: string;
    contentType: string;
    content: Uint8Array;
    contentId?: string | null;
    disposition: "attachment" | "inline";
  }[];
  threadId?: string | null;
  inReplyTo?: string | null;
  references?: string[];
  configurationSet?: string | null;
  idempotencyKey: string;
}

function safeHeader(value: string): string {
  return value.replace(/[\r\n]+/gu, " ").trim();
}

function wrapBase64(value: string): string {
  return value.match(/.{1,76}/gu)?.join("\r\n") ?? "";
}

export function buildRawEmail(input: EmailSendInput): Uint8Array {
  const boundary = `shilabs-${Buffer.from(input.idempotencyKey).toString("hex").slice(0, 32)}`;
  const alternative = `${boundary}-alternative`;
  const headers = [
    `From: ${safeHeader(input.from)}`,
    `To: ${safeHeader(input.to)}`,
    ...(input.cc?.length ? [`Cc: ${input.cc.map(safeHeader).join(", ")}`] : []),
    `Subject: ${safeHeader(input.subject)}`,
    "MIME-Version: 1.0",
    ...(input.inReplyTo ? [`In-Reply-To: ${safeHeader(input.inReplyTo)}`] : []),
    ...(input.references?.length
      ? [`References: ${input.references.map(safeHeader).join(" ")}`]
      : []),
    ...(input.threadId ? [`X-Shilabs-Thread-Id: ${safeHeader(input.threadId)}`] : []),
    `X-Shilabs-Idempotency-Key: ${safeHeader(input.idempotencyKey)}`,
    `Content-Type: multipart/mixed; boundary="${boundary}"`
  ];
  const parts = [headers.join("\r\n"), "", `--${boundary}`];
  if (input.textBody && input.htmlBody) {
    parts.push(
      `Content-Type: multipart/alternative; boundary="${alternative}"`,
      "",
      `--${alternative}`,
      'Content-Type: text/plain; charset="UTF-8"',
      "Content-Transfer-Encoding: 8bit",
      "",
      input.textBody,
      `--${alternative}`,
      'Content-Type: text/html; charset="UTF-8"',
      "Content-Transfer-Encoding: 8bit",
      "",
      input.htmlBody,
      `--${alternative}--`
    );
  } else {
    parts.push(
      `Content-Type: ${input.htmlBody ? "text/html" : "text/plain"}; charset="UTF-8"`,
      "Content-Transfer-Encoding: 8bit",
      "",
      input.htmlBody ?? input.textBody ?? ""
    );
  }
  for (const attachment of input.attachments ?? []) {
    parts.push(
      `--${boundary}`,
      `Content-Type: ${safeHeader(attachment.contentType)}; name="${safeHeader(attachment.fileName)}"`,
      "Content-Transfer-Encoding: base64",
      `Content-Disposition: ${attachment.disposition}; filename="${safeHeader(attachment.fileName)}"`,
      ...(attachment.contentId ? [`Content-ID: <${safeHeader(attachment.contentId)}>`] : []),
      "",
      wrapBase64(Buffer.from(attachment.content).toString("base64"))
    );
  }
  parts.push(`--${boundary}--`, "");
  return Buffer.from(parts.join("\r\n"), "utf8");
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
