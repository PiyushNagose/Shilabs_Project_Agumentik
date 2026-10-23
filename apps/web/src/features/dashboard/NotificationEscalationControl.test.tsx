/** @vitest-environment happy-dom */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InternalNotificationDto } from "@shilabs/shared-types";
import { ApiClientError } from "../../services/api/core.js";
import { escalateNotification } from "../../services/api/notifications.js";
import {
  NotificationDeliveryState,
  NotificationEscalationControl
} from "./NotificationEscalationControl.js";

vi.mock("../../services/api/notifications.js", () => ({ escalateNotification: vi.fn() }));
const updated = { id: "notification", status: "ESCALATED" } as InternalNotificationDto;
const escalate = vi.mocked(escalateNotification);

function setup(props: Partial<React.ComponentProps<typeof NotificationEscalationControl>> = {}) {
  const onChanged = vi.fn<() => void | Promise<void>>();
  render(
    <NotificationEscalationControl
      accessToken="token"
      notificationId="notification"
      onChanged={onChanged}
      {...props}
    />
  );
  return { onChanged };
}

function openForm() {
  fireEvent.click(screen.getByRole("button", { name: "Escalate" }));
  const dialog = screen.getByRole("dialog", { name: "Escalate notification" });
  const form = dialog.querySelector("form");
  if (!form) throw new Error("Escalation form missing");
  return { dialog, form };
}

describe("NotificationEscalationControl", () => {
  beforeEach(() => escalate.mockResolvedValue(updated));
  afterEach(() => {
    cleanup();
    vi.resetAllMocks();
  });

  it("requires a meaningful reason and does not call the API for whitespace", () => {
    setup();
    const { form, dialog } = openForm();
    expect(
      within(dialog).getByRole<HTMLButtonElement>("button", { name: "Escalate" }).disabled
    ).toBe(true);
    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "   " } });
    fireEvent.submit(form);
    expect(screen.getByRole("alert").textContent).toContain("between 3 and 1000");
    expect(escalate).not.toHaveBeenCalled();
  });

  it("submits a trimmed reason and optional local due time, then calls onChanged", async () => {
    const { onChanged } = setup();
    const { form } = openForm();
    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "  Manager review  " } });
    fireEvent.change(screen.getByLabelText("Due date and time (optional)"), {
      target: { value: "2026-10-20T14:30" }
    });
    fireEvent.submit(form);
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith(updated));
    expect(escalate).toHaveBeenCalledWith("token", "notification", {
      reason: "Manager review",
      escalationDueAt: new Date("2026-10-20T14:30").toISOString()
    });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Escalate" }).disabled).toBe(true);
  });

  it("omits an empty due date and prevents duplicate submissions and dismissal while busy", async () => {
    let resolveSend: ((value: InternalNotificationDto) => void) | undefined;
    escalate.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSend = resolve;
        })
    );
    setup();
    const { form } = openForm();
    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "Review needed" } });
    fireEvent.submit(form);
    fireEvent.submit(form);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Escalating..." }).disabled).toBe(
      true
    );
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(escalate).toHaveBeenCalledTimes(1);
    expect(escalate).toHaveBeenCalledWith("token", "notification", { reason: "Review needed" });
    resolveSend?.(updated);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("shows API errors, keeps entered values, and permits retry", async () => {
    escalate.mockRejectedValueOnce(new ApiClientError("Manager access is required", 403));
    const { onChanged } = setup();
    const { form } = openForm();
    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "Review needed" } });
    fireEvent.submit(form);
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe("Manager access is required")
    );
    expect(screen.getByLabelText<HTMLInputElement>("Reason").value).toBe("Review needed");
    expect(onChanged).not.toHaveBeenCalled();
    fireEvent.submit(form);
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
  });

  it("keeps a successful escalation disabled when parent refresh fails", async () => {
    setup({ onChanged: () => Promise.reject(new Error("Refresh failed")) });
    const { form } = openForm();
    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "Review needed" } });
    fireEvent.submit(form);
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("Notification escalated. Refresh")
    );
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Escalate" }).disabled).toBe(true);
    expect(escalate).toHaveBeenCalledTimes(1);
  });

  it.each([{ disabled: true }, { existingStatus: "ESCALATED" as const }])(
    "respects parent protection %j",
    (props) => {
      setup(props);
      fireEvent.click(screen.getByRole("button", { name: "Escalate" }));
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(escalate).not.toHaveBeenCalled();
    }
  );

  it("cancels without sending and clears the draft when reopened", () => {
    setup();
    openForm();
    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "Review needed" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    openForm();
    expect(screen.getByLabelText<HTMLInputElement>("Reason").value).toBe("");
    expect(escalate).not.toHaveBeenCalled();
  });
});

describe("NotificationDeliveryState", () => {
  afterEach(cleanup);
  it.each([
    ["Pending", "Email queued"],
    ["Disabled", "Email alerts disabled"],
    ["NeedsAttention", "Email alert needs attention"],
    ["Accepted", "Email accepted by provider"]
  ])("labels %s without claiming final delivery", (state, label) => {
    render(<NotificationDeliveryState state={state} />);
    expect(screen.getByText(label)).toBeTruthy();
  });
  it.each([undefined, null, "unknown"])("hides absent or unsupported state %s", (state) => {
    const { container } = render(<NotificationDeliveryState state={state} />);
    expect(container.childElementCount).toBe(0);
  });
});
