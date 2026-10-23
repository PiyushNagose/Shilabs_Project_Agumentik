export interface InboundEmailClassification {
  [key: string]: string | number;
  version: 1;
  kind: "MEANINGFUL" | "NONMEANINGFUL";
  reason: string;
}

export function isNonMeaningfulInboundMetadata(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== "object") return false;
  const classification = (metadata as Record<string, unknown>).inboundClassification;
  if (!classification || typeof classification !== "object") return false;
  const value = classification as Record<string, unknown>;
  return value.version === 1 && value.kind === "NONMEANINGFUL";
}

export function classifyInboundEmail(input: {
  header: (name: string) => string | undefined;
  subject: string | null;
  textBody: string;
}): InboundEmailClassification {
  const automatic = (reason: string): InboundEmailClassification => ({
    version: 1,
    kind: "NONMEANINGFUL",
    reason
  });
  const autoSubmitted = input.header("auto-submitted")?.split(";")[0]?.trim().toLowerCase();
  if (autoSubmitted === "auto-replied" || autoSubmitted === "auto-generated") {
    return automatic(`AUTO_SUBMITTED_${autoSubmitted.toUpperCase().replaceAll("-", "_")}`);
  }
  const contentType = input.header("content-type") ?? "";
  if (
    /^multipart\/report\s*;/i.test(contentType) &&
    /;\s*report-type\s*=\s*"?(delivery-status|disposition-notification)"?(?:\s*;|\s*$)/i.test(
      contentType
    )
  ) {
    return automatic("MAIL_SYSTEM_REPORT");
  }
  if (
    input.header("list-id")?.trim() &&
    input.header("list-unsubscribe")?.trim() &&
    /^(bulk|list)$/i.test(input.header("precedence")?.trim() ?? "")
  ) {
    return automatic("BULK_MAILING_LIST");
  }

  // Match an entire short template, never an OOO phrase in quoted or business text.
  // Explicitly human-originated mail and reply/forward subjects cannot use this fallback.
  if (
    !autoSubmitted &&
    /^(?:out of office|ooo|auto(?:matic)?[ -]reply)(?:\s*:.*)?$/i.test(input.subject?.trim() ?? "")
  ) {
    const body = input.textBody.trim().replace(/\s+/g, " ");
    if (
      /^(?:Thank you for your (?:email|message)\. )?I am (?:currently )?(?:out of (?:the )?office|on (?:annual )?leave|away from (?:the )?office)[.!]?(?: I (?:will return|will be back|return) on (?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|\d{4}-\d{2}-\d{2})[.!]?)?$/i.test(
        body
      )
    ) {
      return automatic("OUT_OF_OFFICE_TEMPLATE");
    }
    if (
      /^(?:This is an (?:automatic|automated) (?:reply|response|acknowledg(?:e)?ment)\. )?(?:Your (?:email|message) has been received|We have received your (?:email|message))\.(?: This is an (?:automatic|automated) (?:reply|response|acknowledg(?:e)?ment)\.)?$/i.test(
        body
      )
    ) {
      return automatic("AUTOMATIC_RECEIPT_TEMPLATE");
    }
  }
  return { version: 1, kind: "MEANINGFUL", reason: "NO_CONFIDENT_AUTOMATIC_SIGNAL" };
}
