/** @vitest-environment happy-dom */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { MeetingRequestDto } from "@shilabs/shared-types";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MeetingLifecycleActions } from "./MeetingLifecycleActions.js";
import { recordMeetingOutcome, rescheduleMeetingRequest } from "../../services/api-client.js";

vi.mock("../../components/ToastProvider.js", () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }));
vi.mock("../../services/api-client.js", () => ({
  recordMeetingOutcome: vi.fn(), rescheduleMeetingRequest: vi.fn(),
  apiErrorMessage: (error: unknown) => error instanceof Error ? error.message : "Could not save"
}));

const meeting = {
  id: "meeting-1", leadId: "lead-1", status: "CONFIRMED", outcome: null,
  selectedSlotId: "slot-1", timeZone: "Asia/Kolkata",
  slots: [{ id: "slot-1", startsAt: "2026-01-01T10:00:00Z", endsAt: "2026-01-01T10:30:00Z" }]
} as MeetingRequestDto;

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("meeting lifecycle controls", () => {
  it("keeps the reschedule form and reason when the calendar rejects a change", async () => {
    vi.mocked(rescheduleMeetingRequest).mockRejectedValue(new Error("Calendar is unavailable"));
    const refresh = vi.fn();
    render(<MeetingLifecycleActions accessToken="test-token" meeting={meeting} onRefresh={refresh} />);
    fireEvent.click(screen.getByRole("button", { name: "Reschedule" }));
    fireEvent.change(screen.getByLabelText("Reason for rescheduling"), { target: { value: "Customer requested next week" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Calendar is unavailable");
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("saves the outcome and refreshes persisted meeting data", async () => {
    vi.mocked(recordMeetingOutcome).mockResolvedValue({ ...meeting, outcome: "COMPLETED" });
    const refresh = vi.fn(() => Promise.resolve());
    render(<MeetingLifecycleActions accessToken="test-token" meeting={meeting} onRefresh={refresh} />);
    fireEvent.click(screen.getByRole("button", { name: "Record outcome" }));
    fireEvent.change(screen.getByLabelText("Meeting notes and agreed next steps"), { target: { value: "Customer approved discovery; prepare the proposal." } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(refresh).toHaveBeenCalledWith("lead-1"));
    expect(recordMeetingOutcome).toHaveBeenCalledWith("test-token", "meeting-1", {
      outcome: "COMPLETED", notes: "Customer approved discovery; prepare the proposal.", idempotencyKey: "meeting-outcome:meeting-1"
    });
  });
});
