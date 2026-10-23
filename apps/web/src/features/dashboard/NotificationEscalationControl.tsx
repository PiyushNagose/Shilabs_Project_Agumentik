import type React from "react";
import { useRef, useState } from "react";
import { ArrowUpRight, LoaderCircle } from "lucide-react";
import type { InternalNotificationDto } from "@shilabs/shared-types";
import { Badge, Button, Modal } from "../../components/ui/index.js";
import { apiErrorMessage } from "../../services/api/core.js";
import { escalateNotification } from "../../services/api/notifications.js";

export interface NotificationEscalationControlProps {
  accessToken: string;
  notificationId: string;
  onChanged: (notification: InternalNotificationDto) => void | Promise<void>;
  disabled?: boolean;
  existingStatus?: InternalNotificationDto["status"] | InternalNotificationDto["escalationStatus"];
}

// The parent renders this action only for workspace managers.
export function NotificationEscalationControl({
  accessToken,
  notificationId,
  onChanged,
  disabled = false,
  existingStatus
}: NotificationEscalationControlProps): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [completedId, setCompletedId] = useState<string | null>(null);
  const submitting = useRef(false);
  const blocked = disabled || existingStatus === "ESCALATED" || completedId === notificationId;

  const close = (): void => {
    if (!submitting.current) setOpen(false);
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (submitting.current || blocked) return;
    const trimmedReason = reason.trim();
    if (trimmedReason.length < 3 || trimmedReason.length > 1000) {
      setError("Enter a reason between 3 and 1000 characters.");
      return;
    }
    const dueDate = dueAt ? new Date(dueAt) : null;
    if (dueDate && !Number.isFinite(dueDate.getTime())) {
      setError("Enter a valid due date and time.");
      return;
    }
    submitting.current = true;
    setBusy(true);
    setError(null);
    try {
      const notification = await escalateNotification(accessToken, notificationId, {
        reason: trimmedReason,
        ...(dueDate ? { escalationDueAt: dueDate.toISOString() } : {})
      });
      setCompletedId(notificationId);
      setOpen(false);
      try {
        await onChanged(notification);
      } catch {
        setError("Notification escalated. Refresh to see the latest status.");
      }
    } catch (cause) {
      setError(
        apiErrorMessage(cause, "The notification could not be escalated. Please try again.")
      );
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };

  return (
    <>
      <Button
        size="sm"
        disabled={blocked || busy}
        onClick={() => {
          setReason("");
          setDueAt("");
          setError(null);
          setOpen(true);
        }}
      >
        <ArrowUpRight size={16} aria-hidden="true" /> Escalate
      </Button>
      {error && !open ? (
        <p className="admin-inline-error" role="alert">
          {error}
        </p>
      ) : null}
      <Modal open={open} title="Escalate notification" onClose={close}>
        <form className="admin-form-grid" aria-busy={busy} onSubmit={(event) => void submit(event)}>
          <label className="admin-field-full">
            Reason
            <input
              autoFocus
              required
              minLength={3}
              maxLength={1000}
              value={reason}
              disabled={busy}
              onChange={(event) => setReason(event.target.value)}
            />
          </label>
          <label className="admin-field-full">
            Due date and time (optional)
            <input
              type="datetime-local"
              value={dueAt}
              disabled={busy}
              onChange={(event) => setDueAt(event.target.value)}
            />
          </label>
          {error ? (
            <p className="admin-inline-error admin-field-full" role="alert">
              {error}
            </p>
          ) : null}
          <div className="admin-form-footer admin-field-full">
            <Button disabled={busy} onClick={close}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={blocked || busy || reason.trim().length < 3}
            >
              {busy ? (
                <LoaderCircle size={16} aria-hidden="true" />
              ) : (
                <ArrowUpRight size={16} aria-hidden="true" />
              )}
              {busy ? "Escalating..." : "Escalate"}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}

export function NotificationDeliveryState({
  state
}: {
  state?: string | null;
}): React.JSX.Element | null {
  let label: string;
  let tone: "neutral" | "warning" | "accent";
  switch (state) {
    case "Pending":
      label = "Email queued";
      tone = "neutral";
      break;
    case "Disabled":
      label = "Email alerts disabled";
      tone = "neutral";
      break;
    case "NeedsAttention":
      label = "Email alert needs attention";
      tone = "warning";
      break;
    case "Accepted":
      label = "Email accepted by provider";
      tone = "accent";
      break;
    default:
      return null;
  }
  return (
    <span aria-label="Escalation email delivery">
      <Badge tone={tone}>{label}</Badge>
    </span>
  );
}
