import { useState } from "react";
import type { MeetingRequestDto } from "@shilabs/shared-types";
import { CalendarClock, ClipboardCheck, Save } from "lucide-react";
import { Button, Modal, Select } from "../../components/ui/index.js";
import { useToast } from "../../components/ToastProvider.js";
import { apiErrorMessage, recordMeetingOutcome, rescheduleMeetingRequest } from "../../services/api-client.js";
import { formatDateTime } from "../../utils/date-time.js";

function localInputValue(value: string | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

export function MeetingLifecycleActions({ accessToken, meeting, onRefresh }: {
  accessToken: string;
  meeting: MeetingRequestDto;
  onRefresh: (leadId: string) => Promise<void>;
}): React.JSX.Element | null {
  const toast = useToast();
  const [mode, setMode] = useState<"reschedule" | "outcome" | null>(null);
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [notes, setNotes] = useState("");
  const [outcome, setOutcome] = useState<"COMPLETED" | "NO_SHOW">("COMPLETED");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const slot = meeting.slots.find((item) => item.id === meeting.selectedSlotId);
  if (meeting.status !== "CONFIRMED") return null;
  if (meeting.outcome) return (
    <div className="meeting-outcome-summary">
      <strong>{meeting.outcome === "COMPLETED" ? "Meeting completed" : "Customer did not attend"}</strong>
      <p>{meeting.outcomeNotes}</p>
      <small>Recorded {formatDateTime(meeting.completedAt)}</small>
    </div>
  );

  const open = (next: "reschedule" | "outcome"): void => {
    setStartsAt(localInputValue(slot?.startsAt));
    setEndsAt(localInputValue(slot?.endsAt));
    setNotes("");
    setError(null);
    setMode(next);
  };
  const save = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      if (mode === "reschedule") {
        await rescheduleMeetingRequest(accessToken, meeting.id, {
          startsAt: new Date(startsAt).toISOString(),
          endsAt: new Date(endsAt).toISOString(),
          reason: notes.trim()
        });
      } else {
        await recordMeetingOutcome(accessToken, meeting.id, {
          outcome, notes: notes.trim(), idempotencyKey: `meeting-outcome:${meeting.id}`
        });
      }
      await onRefresh(meeting.leadId);
      setMode(null);
      toast.success({ title: mode === "reschedule" ? "Meeting rescheduled" : "Meeting outcome saved" });
    } catch (saveError) {
      setError(apiErrorMessage(saveError, "The meeting could not be updated"));
    } finally { setBusy(false); }
  };

  return (
    <>
      <div className="meeting-lifecycle-actions">
        <Button type="button" variant="secondary" onClick={() => open("reschedule")}><CalendarClock size={16} />Reschedule</Button>
        <Button type="button" variant="secondary" disabled={!slot || new Date(slot.startsAt) > new Date()} onClick={() => open("outcome")}><ClipboardCheck size={16} />Record outcome</Button>
      </div>
      <Modal open={mode !== null} onClose={() => { if (!busy) setMode(null); }} title={mode === "reschedule" ? "Reschedule meeting" : "Record meeting outcome"}>
        <form className="lead-create-form" onSubmit={(event) => { event.preventDefault(); void save(); }}>
          {error ? <p className="form-error" role="alert">{error}</p> : null}
          {mode === "reschedule" ? (
            <div className="lead-create-form-grid">
              <label>Start time ({Intl.DateTimeFormat().resolvedOptions().timeZone})<input type="datetime-local" required value={startsAt} disabled={busy} onChange={(event) => setStartsAt(event.target.value)} /></label>
              <label>End time ({Intl.DateTimeFormat().resolvedOptions().timeZone})<input type="datetime-local" required value={endsAt} disabled={busy} onChange={(event) => setEndsAt(event.target.value)} /></label>
            </div>
          ) : (
            <label>Outcome<Select ariaLabel="Meeting outcome" disabled={busy} value={outcome} onChange={(value) => setOutcome(value as "COMPLETED" | "NO_SHOW")} options={[{ value: "COMPLETED", label: "Meeting completed" }, { value: "NO_SHOW", label: "Customer did not attend" }]} /></label>
          )}
          <label>{mode === "reschedule" ? "Reason for rescheduling" : "Meeting notes and agreed next steps"}<textarea required rows={4} minLength={mode === "reschedule" ? 3 : 5} maxLength={mode === "reschedule" ? 500 : 5000} value={notes} disabled={busy} onChange={(event) => setNotes(event.target.value)} /></label>
          <div className="proposal-actions">
            <Button type="button" variant="secondary" disabled={busy} onClick={() => setMode(null)}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={busy}><Save size={16} />{busy ? "Saving..." : "Save changes"}</Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
