import { createRequire } from "node:module";
import { AppError } from "../../shared/errors.js";
import type { SesInboundNotification } from "./email-feedback.schemas.js";

const require = createRequire(import.meta.url);
export const MAX_INBOUND_MIME_BYTES = 10 * 1024 * 1024;

interface MimeAddress {
  value: { address?: string; group?: { address?: string }[] }[];
}

export interface ParsedInboundMime {
  text?: string;
  html?: string | false;
  subject?: string;
  from?: MimeAddress;
  to?: MimeAddress | MimeAddress[];
  cc?: MimeAddress | MimeAddress[];
  headerLines: { key: string; line: string }[];
  attachments: {
    content?: Buffer;
    filename?: string;
    contentType: string;
    size: number;
    contentId?: string;
    contentDisposition?: string;
  }[];
}

export type InboundMimeParser = (raw: Buffer) => Promise<ParsedInboundMime>;

const parseMime: InboundMimeParser = async (raw) => {
  const { simpleParser } = require("mailparser") as {
    simpleParser: (source: Buffer, options: object) => Promise<ParsedInboundMime>;
  };
  return simpleParser(raw, { skipHtmlToText: false, skipImageLinks: true, skipTextToHtml: true });
};

function addresses(value: MimeAddress | MimeAddress[] | undefined): string[] {
  return (value ? (Array.isArray(value) ? value : [value]) : []).flatMap((entry) =>
    entry.value.flatMap((item) =>
      item.address ? [item.address] : (item.group ?? []).flatMap((member) => member.address ? [member.address] : [])
    )
  );
}

export async function parseInboundMime(
  raw: Buffer,
  parser: InboundMimeParser = parseMime
): Promise<{ headers: Map<string, string>; textBody: string; htmlBody?: string;
  commonHeaders: NonNullable<SesInboundNotification["mail"]["commonHeaders"]>;
  attachmentContents: (Buffer | undefined)[];
  attachments: NonNullable<SesInboundNotification["attachments"]> }> {
  if (raw.byteLength > MAX_INBOUND_MIME_BYTES) {
    throw new AppError(413, "VALIDATION_ERROR", "Inbound MIME exceeds byte limit");
  }
  let parsed: ParsedInboundMime;
  try {
    parsed = await parser(raw);
  } catch {
    throw new AppError(400, "VALIDATION_ERROR", "Inbound MIME could not be parsed");
  }
  if (parsed.attachments.length > 100) {
    throw new AppError(413, "VALIDATION_ERROR", "Inbound MIME has too many attachments");
  }
  const headers = new Map<string, string>();
  for (const { key, line } of parsed.headerLines) {
    const value = line.slice(line.indexOf(":") + 1).replace(/\r?\n[ \t]+/g, " ").trim();
    headers.set(key.toLowerCase(), value);
  }
  if (parsed.subject !== undefined) headers.set("subject", parsed.subject);
  return {
    headers,
    textBody: (parsed.text ?? "").slice(0, 50000),
    htmlBody: typeof parsed.html === "string" ? parsed.html : undefined,
    attachmentContents: parsed.attachments.map((item) => item.content),
    commonHeaders: {
      from: addresses(parsed.from), to: addresses(parsed.to), cc: addresses(parsed.cc),
      subject: parsed.subject
    },
    attachments: parsed.attachments.map((item, index) => ({
      fileName: (item.filename?.length ? item.filename : `attachment-${String(index + 1)}`).slice(0, 255),
      contentType: item.contentType.slice(0, 255), sizeBytes: item.size,
      contentId: item.contentId?.slice(0, 255),
      disposition: item.contentDisposition === "inline" ? "inline" : "attachment"
    }))
  };
}
