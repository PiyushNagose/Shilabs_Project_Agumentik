import { useEffect, useRef, useState } from "react";
import type { CommunicationAttachmentDto } from "@shilabs/shared-types";
import { Download, LoaderCircle, Paperclip } from "lucide-react";
import { Button } from "../../components/ui/index.js";
import {
  apiBaseUrl,
  apiHeaders,
  ApiClientError,
  apiErrorMessage
} from "../../services/api/core.js";

export interface ConversationAttachmentProps {
  accessToken: string;
  conversationId: string;
  messageId: string;
  index: number;
  attachment: CommunicationAttachmentDto;
}

export function ConversationAttachment(props: ConversationAttachmentProps) {
  // Remount on identity or authentication changes to discard bytes from the previous context.
  return (
    <AttachmentContent
      key={`${props.accessToken}:${props.conversationId}:${props.messageId}:${String(props.index)}`}
      {...props}
    />
  );
}

function AttachmentContent({
  accessToken,
  conversationId,
  messageId,
  index,
  attachment
}: ConversationAttachmentProps) {
  const [loaded, setLoaded] = useState<{ url: string; type: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lifetime = useRef<{ controller?: AbortController; url?: string; active: boolean }>({
    active: true
  });
  useEffect(() => {
    const current = lifetime.current;
    current.active = true;
    return () => {
      current.active = false;
      current.controller?.abort();
      if (current.url) URL.revokeObjectURL(current.url);
    };
  }, []);

  async function load() {
    if (lifetime.current.controller) return;
    const controller = new AbortController();
    lifetime.current.controller = controller;
    setLoading(true);
    setError(null);
    try {
      const conversationPath = encodeURIComponent(conversationId);
      const messagePath = encodeURIComponent(messageId);
      const response = await fetch(
        `${apiBaseUrl}/api/conversations/${conversationPath}/messages/${messagePath}/attachments/${String(index)}/download`,
        {
          headers: apiHeaders({ Authorization: `Bearer ${accessToken}` }),
          cache: "no-store",
          redirect: "error",
          signal: controller.signal
        }
      );
      if (!response.ok) {
        if (response.status === 401) window.dispatchEvent(new Event("shilabs:auth-invalid"));
        const payload: unknown = await response.json().catch(() => null);
        const details = payload && typeof payload === "object" ? payload : {};
        const nested =
          "error" in details && details.error && typeof details.error === "object"
            ? details.error
            : details;
        const message: unknown = "message" in nested ? nested.message : undefined;
        throw new ApiClientError(
          typeof message === "string" ? message : "Attachment is unavailable",
          response.status
        );
      }
      const blob = await response.blob();
      if (blob.size > 10 * 1024 * 1024) throw new ApiClientError("Attachment exceeds 10 MB", 413);
      if (!lifetime.current.active || controller.signal.aborted) return;
      const url = URL.createObjectURL(blob);
      lifetime.current.url = url;
      setLoaded({ url, type: blob.type.split(";")[0] ?? "" });
    } catch (failure) {
      if (lifetime.current.active && !controller.signal.aborted)
        setError(apiErrorMessage(failure, "Attachment could not be loaded"));
    } finally {
      lifetime.current.controller = undefined;
      if (lifetime.current.active) setLoading(false);
    }
  }

  return (
    <div className="conversation-attachment">
      <span className="conversation-attachment-name">
        <Paperclip size={14} aria-hidden="true" /> {attachment.fileName}
      </span>
      {!loaded && (
        <Button size="sm" disabled={loading} onClick={() => void load()}>
          {loading ? (
            <LoaderCircle size={14} aria-hidden="true" />
          ) : (
            <Download size={14} aria-hidden="true" />
          )}
          {loading ? "Loading attachment" : "Load attachment"}
        </Button>
      )}
      {error && (
        <span role="alert" className="conversation-attachment-error">
          {error}
        </span>
      )}
      {loaded && (
        <>
          {/^image\/(jpeg|png|gif|webp|avif)$/.test(loaded.type) && (
            <img
              className="conversation-attachment-preview"
              src={loaded.url}
              alt={attachment.fileName}
              style={{ maxWidth: "100%", maxHeight: 320, objectFit: "contain" }}
            />
          )}
          {loaded.type.startsWith("audio/") && (
            <audio controls preload="none" src={loaded.url} style={{ maxWidth: "100%" }} />
          )}
          {loaded.type.startsWith("video/") && (
            <video
              controls
              preload="metadata"
              src={loaded.url}
              style={{ maxWidth: "100%", maxHeight: 320 }}
            />
          )}
          <a
            className="conversation-attachment-download"
            href={loaded.url}
            download={attachment.fileName.replace(/[^a-zA-Z0-9._ -]/g, "_") || "attachment"}
          >
            <Download size={14} aria-hidden="true" /> Download
          </a>
        </>
      )}
    </div>
  );
}
