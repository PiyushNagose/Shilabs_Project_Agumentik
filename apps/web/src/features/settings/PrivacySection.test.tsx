/**
 * @vitest-environment happy-dom
 */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PublicUser } from "@shilabs/shared-types";
import { PrivacySection } from "./PrivacySection.js";
import { eraseContactData } from "../../services/api/privacy.js";

vi.mock("../../services/api/contacts.js", () => ({
  listContacts: vi
    .fn()
    .mockResolvedValue([
      { id: "contact_1", firstName: "Anika", lastName: "Sethi", email: "anika@example.test" }
    ])
}));
vi.mock("../../services/api/privacy.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../services/api/privacy.js")>()),
  getPrivacyPolicy: vi.fn().mockResolvedValue({ enabled: false, revision: 1, periods: {} }),
  eraseContactData: vi.fn()
}));
const user: PublicUser = {
  id: "admin_1",
  firstName: "Development",
  lastName: "Admin",
  email: "admin@example.test",
  role: "ADMIN",
  status: "ACTIVE",
  createdAt: "2026-10-21T00:00:00Z",
  updatedAt: "2026-10-21T00:00:00Z"
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("Privacy settings layout", () => {
  it("groups contact controls separately and preserves erasure confirmation", async () => {
    render(<PrivacySection accessToken="test" currentUser={user} />);
    const section = within(await screen.findByRole("region", { name: "Contact data" }));
    expect(section.getByRole("heading", { name: "Contact data" })).toBeTruthy();
    const erase = section.getByRole<HTMLButtonElement>("button", { name: "Erase contact" });
    expect(erase.disabled).toBe(true);
    expect(
      section.getByRole<HTMLButtonElement>("button", { name: "Export contact" }).disabled
    ).toBe(true);
    fireEvent.change(section.getByRole("combobox", { name: "Contact" }), { target: { value: "contact_1" } });
    expect(erase.disabled).toBe(false);
    fireEvent.click(erase);
    const dialog = within(screen.getByRole("dialog", { name: "Erase contact data" }));
    expect(dialog.getByRole<HTMLButtonElement>("button", { name: "Erase contact" }).disabled).toBe(
      true
    );
    expect(eraseContactData).not.toHaveBeenCalled();
    expect(screen.getAllByRole("spinbutton")).toHaveLength(8);
  });

  it("does not expose erasure controls to sales managers", async () => {
    render(<PrivacySection accessToken="test" currentUser={{ ...user, role: "SALES_MANAGER" }} />);
    const section = within(await screen.findByRole("region", { name: "Contact data" }));
    expect(section.getByRole("button", { name: "Export contact" })).toBeTruthy();
    expect(section.queryByRole("button", { name: "Erase contact" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Save policy" })).toBeNull();
  });
});
