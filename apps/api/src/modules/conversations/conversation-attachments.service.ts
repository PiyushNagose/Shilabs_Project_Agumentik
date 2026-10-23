import { getMessagingConfig } from "@shilabs/shared-config";
import type { AuthenticatedUser } from "../auth/auth.types.js";
import { assertCanAccessLead } from "../leads/lead.permissions.js";
import { prisma } from "../../shared/prisma.js";
import { AppError } from "../../shared/errors.js";
import { downloadStoredSesAttachment } from "../email/email-ses-receiving.service.js";

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const TIMEOUT_MS = 15_000;

function unavailable(): never {
  throw new AppError(404, "NOT_FOUND", "Attachment bytes are unavailable");
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function sanitizeAttachmentFilename(value: unknown): string {
  return (
    (typeof value === "string" ? value : "attachment")
      .replace(/[^a-zA-Z0-9._ -]/g, "_")
      .replace(/^\.+/, "")
      .trim()
      .slice(0, 150) || "attachment"
  );
}

function secureUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return unavailable();
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.hash)
    return unavailable();
  return url;
}

function metaBinaryUrl(value: string): URL {
  const url = secureUrl(value);
  if (
    url.hostname !== "lookaside.fbsbx.com" &&
    url.hostname !== "platform-lookaside.fbsbx.com" &&
    !/^(?:[a-z0-9-]+\.)+fbcdn\.net$/i.test(url.hostname)
  )
    return unavailable();
  return url;
}

// Bound the actual stream as well as Content-Length, which may be absent or inaccurate.
async function fetchBytes(url: URL, authorization: string, limit: number, signal: AbortSignal, twilioRedirect = false) {
  let response = await fetch(url, {
    headers: { Authorization: authorization },
    redirect: twilioRedirect ? "manual" : "error",
    signal
  });
  if (twilioRedirect && [301, 302, 303, 307, 308].includes(response.status)) {
    const location = response.headers.get("location");
    await response.body?.cancel();
    if (!location) return unavailable();
    const target = secureUrl(location);
    if (target.hostname !== "mms.twiliocdn.com") return unavailable();
    // Signed CDN links authorize themselves; never forward the Twilio account credentials.
    response = await fetch(target, { redirect: "error", signal });
  }
  if (!response.ok) {
    await response.body?.cancel();
    if (response.status === 404 || response.status === 410) return unavailable();
    throw new AppError(
      502,
      "PROVIDER_ERROR",
      "Attachment provider could not complete the download"
    );
  }
  if (Number(response.headers.get("content-length")) > limit) {
    await response.body?.cancel();
    throw new AppError(413, "VALIDATION_ERROR", "Attachment exceeds the download size limit");
  }
  if (!response.body) return unavailable();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new AppError(413, "VALIDATION_ERROR", "Attachment exceeds the download size limit");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return { bytes: Buffer.concat(chunks, size), contentType: response.headers.get("content-type") };
}

function safeContentType(value: unknown): string {
  const type = typeof value === "string" ? (value.split(";")[0] ?? "").trim().toLowerCase() : "";
  return /^(?:image\/(?:jpeg|png|gif|webp|avif)|audio\/(?:mpeg|mp4|ogg|wav|webm|aac|opus)|video\/(?:mp4|webm|ogg)|application\/pdf)$/.test(
    type
  )
    ? type
    : "application/octet-stream";
}

export async function downloadConversationAttachment(
  actor: AuthenticatedUser,
  conversationId: string,
  messageId: string,
  index: string
): Promise<{ bytes: Buffer; fileName: string; contentType: string }> {
  if (!actor.activeWorkspaceId)
    throw new AppError(403, "AUTHORIZATION_ERROR", "An active workspace is required");
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    include: { lead: true }
  });
  if (!conversation) return unavailable();
  assertCanAccessLead(actor, conversation.lead);
  if (conversation.workspaceId !== actor.activeWorkspaceId) return unavailable();
  if (!/^(0|[1-9][0-9]*)$/.test(index) || !Number.isSafeInteger(Number(index)))
    return unavailable();
  const message = await prisma.message.findFirst({
    where: { id: messageId, conversationId, workspaceId: actor.activeWorkspaceId }
  });
  if (message?.conversationId !== conversationId || message.workspaceId !== actor.activeWorkspaceId)
    return unavailable();
  // Match the DTO's filtering so the public attachment index selects the same stored entry.
  const attachments = Array.isArray(message.attachmentMetadata)
    ? message.attachmentMetadata
        .map(record)
        .filter(
          (item) =>
            typeof item.fileName === "string" &&
            typeof item.contentType === "string" &&
            typeof item.sizeBytes === "number"
        )
    : [];
  const attachment = attachments[Number(index)];
  if (!attachment) return unavailable();
  if (Number(attachment.sizeBytes) > MAX_ATTACHMENT_BYTES)
    throw new AppError(413, "VALIDATION_ERROR", "Attachment exceeds the download size limit");
  if (conversation.channel === "EMAIL") {
    const inbound = await prisma.inboundEmail.findFirst({
      where: { messageId, conversationId, workspaceId: actor.activeWorkspaceId, provider: "AWS_SES" },
      select: { rawProviderPayload: true }
    });
    if (!inbound) return unavailable();
    const result = await downloadStoredSesAttachment(inbound.rawProviderPayload, Number(index));
    return { ...result, fileName: sanitizeAttachmentFilename(result.fileName), contentType: safeContentType(result.contentType) };
  }
  if (conversation.channel !== "WHATSAPP") return unavailable();
  const provider = record(message.metadata).provider;
  const mediaId = attachment.providerAttachmentId;
  if (typeof mediaId !== "string") return unavailable();
  const config = getMessagingConfig();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    let result: Awaited<ReturnType<typeof fetchBytes>>;
    if (provider === "META_WHATSAPP") {
      if (!/^\d+$/.test(mediaId) || !config.metaWhatsApp.accessToken) return unavailable();
      const base = secureUrl(config.metaWhatsApp.graphApiBaseUrl);
      if (
        base.hostname !== "graph.facebook.com" ||
        base.search ||
        !/^\/v\d+\.\d+\/?$/.test(base.pathname)
      )
        return unavailable();
      const authorization = `Bearer ${config.metaWhatsApp.accessToken}`;
      const resolved = await fetchBytes(
        new URL(`${base.href.replace(/\/$/, "")}/${mediaId}`),
        authorization,
        64 * 1024,
        controller.signal
      );
      let metadata: Record<string, unknown>;
      try {
        metadata = record(JSON.parse(resolved.bytes.toString("utf8")));
      } catch {
        return unavailable();
      }
      if (typeof metadata.url !== "string") return unavailable();
      if (Number(metadata.file_size) > MAX_ATTACHMENT_BYTES)
        throw new AppError(413, "VALIDATION_ERROR", "Attachment exceeds the download size limit");
      result = await fetchBytes(
        metaBinaryUrl(metadata.url),
        authorization,
        MAX_ATTACHMENT_BYTES,
        controller.signal
      );
    } else if (provider === "TWILIO_WHATSAPP" || provider === "TWILIO") {
      const { accountSid, authToken } = config.twilioWhatsApp;
      const stored = secureUrl(mediaId);
      const match =
        /^\/2010-04-01\/Accounts\/(AC[0-9a-f]{32})\/Messages\/((?:SM|MM)[0-9a-f]{32})\/Media\/(ME[0-9a-f]{32})$/i.exec(
          stored.pathname
        );
      if (
        stored.hostname !== "api.twilio.com" ||
        stored.search ||
        match?.[1] !== accountSid ||
        match[2] !== message.providerMessageId ||
        !authToken
      )
        return unavailable();
      const canonical = new URL(
        `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages/${match[2]}/Media/${String(match[3])}`
      );
      result = await fetchBytes(
        canonical,
        `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
        MAX_ATTACHMENT_BYTES,
        controller.signal,
        true
      );
    } else return unavailable();
    if (!result.bytes.length) return unavailable();
    return {
      bytes: result.bytes,
      fileName: sanitizeAttachmentFilename(attachment.fileName),
      contentType: safeContentType(result.contentType)
    };
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(502, "PROVIDER_ERROR", "Attachment download failed or timed out");
  } finally {
    clearTimeout(timer);
  }
}
