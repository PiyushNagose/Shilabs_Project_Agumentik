import path from "node:path";
import https from "node:https";
import { resolve4 } from "node:dns/promises";
import { isIP } from "node:net";
import type { RequestHandler } from "express";
import mammoth from "mammoth";
import multer from "multer";
import { PDFParse } from "pdf-parse";
import { AppError } from "../../shared/errors.js";
import { extractPdfWithOcr } from "./lead-document-ocr.js";

export const MAX_LEAD_DOCUMENT_BYTES = 10 * 1024 * 1024;
export const MAX_EXTRACTED_TEXT_CHARACTERS = 250_000;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_LEAD_DOCUMENT_BYTES, files: 1, fields: 4 }
});

export interface ExtractedLeadDocument {
  content: string;
  mimeType:
    | "application/pdf"
    | "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    | "text/plain";
}

function uploadError(error: unknown): AppError {
  if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
    return new AppError(413, "VALIDATION_ERROR", "The document exceeds the 10 MB upload limit");
  }
  if (error instanceof multer.MulterError) {
    return new AppError(400, "VALIDATION_ERROR", "Upload exactly one document in the file field");
  }
  return new AppError(400, "VALIDATION_ERROR", "The document upload could not be processed");
}

export const parseLeadDocumentUpload: RequestHandler = (request, response, next) => {
  upload.single("file")(request, response, (error: unknown) => {
    if (error) next(uploadError(error));
    else next();
  });
};

function sanitizeExtractedText(value: string): string {
  const withoutUnsafeControls = Array.from(value, (character) => {
    const code = character.charCodeAt(0);
    return (code < 32 && code !== 9 && code !== 10 && code !== 13) || code === 127 ? "" : character;
  }).join("");
  return withoutUnsafeControls
    .normalize("NFC")
    .replace(/\r\n?/gu, "\n")
    .replace(/[ \t]+\n/gu, "\n")
    .replace(/\n{4,}/gu, "\n\n\n")
    .trim();
}

function assertExtractedText(content: string): string {
  const sanitized = sanitizeExtractedText(content);
  if (!sanitized) {
    throw new AppError(
      400,
      "VALIDATION_ERROR",
      "Needs Attention: No readable text was found in the document. Upload a clearer document."
    );
  }
  if (sanitized.length > MAX_EXTRACTED_TEXT_CHARACTERS) {
    throw new AppError(
      413,
      "VALIDATION_ERROR",
      "The extracted document text exceeds the 250,000 character limit"
    );
  }
  return sanitized;
}

function assertMimeType(file: Express.Multer.File, allowed: readonly string[]): void {
  if (allowed.includes(file.mimetype.toLowerCase())) return;
  throw new AppError(
    400,
    "VALIDATION_ERROR",
    "The selected file type does not match its extension"
  );
}

async function extractPdf(file: Express.Multer.File): Promise<string> {
  assertMimeType(file, ["application/pdf", "application/octet-stream"]);
  if (file.buffer.subarray(0, 5).toString("ascii") !== "%PDF-") {
    throw new AppError(400, "VALIDATION_ERROR", "The selected file is not a valid PDF document");
  }
  const parser = new PDFParse({ data: file.buffer });
  try {
    return await extractPdfWithOcr(parser);
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(
      400,
      "VALIDATION_ERROR",
      "The PDF could not be read. It may be encrypted or damaged."
    );
  } finally {
    await parser.destroy();
  }
}

async function extractDocx(file: Express.Multer.File): Promise<string> {
  assertMimeType(file, [
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/zip",
    "application/octet-stream"
  ]);
  if (file.buffer.subarray(0, 2).toString("ascii") !== "PK") {
    throw new AppError(400, "VALIDATION_ERROR", "The selected file is not a valid DOCX document");
  }
  try {
    const result = await mammoth.extractRawText({ buffer: file.buffer });
    return result.value;
  } catch {
    throw new AppError(
      400,
      "VALIDATION_ERROR",
      "The DOCX document could not be read. It may be damaged."
    );
  }
}

function extractText(file: Express.Multer.File): string {
  assertMimeType(file, ["text/plain", "application/octet-stream"]);
  if (file.buffer.includes(0)) {
    throw new AppError(400, "VALIDATION_ERROR", "The selected TXT file contains binary data");
  }
  return file.buffer.toString("utf8");
}

export async function extractLeadDocumentUpload(
  file: Express.Multer.File | undefined
): Promise<ExtractedLeadDocument> {
  if (!file) {
    throw new AppError(400, "VALIDATION_ERROR", "Select a PDF, DOCX, or TXT document to upload");
  }
  const extension = path.extname(path.basename(file.originalname)).toLowerCase();
  if (extension === ".pdf") {
    return { content: assertExtractedText(await extractPdf(file)), mimeType: "application/pdf" };
  }
  if (extension === ".docx") {
    return {
      content: assertExtractedText(await extractDocx(file)),
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    };
  }
  if (extension === ".txt") {
    return { content: assertExtractedText(extractText(file)), mimeType: "text/plain" };
  }
  throw new AppError(400, "VALIDATION_ERROR", "Only PDF, DOCX, and TXT documents are supported");
}

function publicDocumentUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new AppError(400, "VALIDATION_ERROR", "Enter a valid document link");
  }
  const hostname = url.hostname.toLowerCase();
  if (
    url.protocol !== "https:" ||
    (url.port && url.port !== "443") ||
    url.username ||
    url.password ||
    isIP(hostname) !== 0 ||
    hostname === "localhost" ||
    /\.(?:localhost|local|internal|invalid|test|example)$/u.test(hostname)
  ) {
    throw new AppError(400, "VALIDATION_ERROR", "Use a public HTTPS document link");
  }
  return url;
}

function isPublicIpv4(address: string): boolean {
  const parts = address.split(".").map(Number);
  const [a, b, c] = parts;
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255))
    return false;
  return !(
    a === 0 || a === 10 || a === 127 || a === 169 && b === 254 ||
    a === 172 && b !== undefined && b >= 16 && b <= 31 ||
    a === 192 && b === 168 || a === 192 && b === 0 ||
    a === 100 && b !== undefined && b >= 64 && b <= 127 ||
    a === 198 && (b === 18 || b === 19 || b === 51 && c === 100) ||
    a === 203 && b === 0 && c === 113 ||
    a !== undefined && a >= 224
  );
}

async function pinnedPublicAddress(hostname: string): Promise<string> {
  let addresses: string[];
  try {
    addresses = await resolve4(hostname);
  } catch {
    throw new AppError(400, "VALIDATION_ERROR", "The document host could not be reached");
  }
  const address = addresses[0];
  if (!address || addresses.some((item) => !isPublicIpv4(item))) {
    throw new AppError(400, "VALIDATION_ERROR", "The document link must use a public host");
  }
  return address;
}

async function readPublicDocument(url: URL): Promise<{ buffer: Buffer; mimeType: string; url: URL }> {
  const address = await pinnedPublicAddress(url.hostname);
  return new Promise((resolve, reject) => {
    const request = https.get(
      url,
      {
        timeout: 8_000,
        lookup: (_host, _options, callback) => callback(null, address, 4),
        headers: { Accept: "application/pdf, application/vnd.openxmlformats-officedocument.wordprocessingml.document, text/plain", "User-Agent": "ShilabsCRM-DocumentIndexer/1.0" }
      },
      (response) => {
        const status = response.statusCode ?? 0;
        if (status >= 300 && status < 400 && response.headers.location) {
          response.resume();
          try {
            resolve({ buffer: Buffer.alloc(0), mimeType: "REDIRECT", url: new URL(response.headers.location, url) });
          } catch {
            reject(new AppError(400, "VALIDATION_ERROR", "The document link redirected to an invalid address"));
          }
          return;
        }
        if (status !== 200) {
          response.resume();
          reject(new AppError(400, "VALIDATION_ERROR", "The document link could not be downloaded"));
          return;
        }
        const mimeType = (response.headers["content-type"] ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
        const buffers: Buffer[] = [];
        let size = 0;
        response.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_LEAD_DOCUMENT_BYTES) {
            response.destroy(new AppError(413, "VALIDATION_ERROR", "The linked document exceeds the 10 MB limit"));
            return;
          }
          buffers.push(chunk);
        });
        response.on("error", reject);
        response.on("end", () => resolve({ buffer: Buffer.concat(buffers), mimeType, url }));
      }
    );
    request.on("timeout", () => request.destroy(new AppError(408, "VALIDATION_ERROR", "The document link timed out")));
    request.on("error", reject);
  });
}

export async function extractLeadDocumentLink(value: string): Promise<ExtractedLeadDocument> {
  let url = publicDocumentUrl(value);
  for (let redirect = 0; redirect <= 3; redirect += 1) {
    const result = await readPublicDocument(url);
    if (result.mimeType === "REDIRECT") {
      url = publicDocumentUrl(result.url.toString());
      continue;
    }
    const extension = result.mimeType === "application/pdf" ? ".pdf"
      : result.mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ? ".docx"
      : result.mimeType === "text/plain" ? ".txt" : "";
    if (!extension) {
      throw new AppError(400, "VALIDATION_ERROR", "Linked documents must be PDF, DOCX or TXT files");
    }
    return extractLeadDocumentUpload({
      buffer: result.buffer,
      originalname: `${path.basename(url.pathname) || "document"}${extension}`,
      mimetype: result.mimeType
    } as Express.Multer.File);
  }
  throw new AppError(400, "VALIDATION_ERROR", "The document link redirected too many times");
}
