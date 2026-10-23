/**
 * @vitest-environment happy-dom
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PublicUser } from "@shilabs/shared-types";
import { UsersWorkspace } from "./UsersWorkspace.js";
import { createUser } from "../../services/api-client.js";

vi.mock("../../hooks/usePersistedResource.js", () => ({
  usePersistedResource: () => ({
    data: [
      {
        id: "admin_1",
        email: "admin@example.local",
        firstName: "Avery",
        lastName: "Admin",
        role: "ADMIN",
        status: "ACTIVE",
        createdAt: "2026-10-10T10:00:00.000Z",
        updatedAt: "2026-10-10T10:00:00.000Z"
      }
    ],
    loading: false,
    error: null,
    reload: vi.fn()
  })
}));
vi.mock("../../services/api-client.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../services/api-client.js")>()),
  createUser: vi.fn().mockResolvedValue({})
}));

const admin = {
  id: "admin_1",
  email: "admin@example.local",
  firstName: "Avery",
  lastName: "Admin",
  role: "ADMIN",
  status: "ACTIVE",
  createdAt: "2026-10-10T10:00:00.000Z",
  updatedAt: "2026-10-10T10:00:00.000Z"
} satisfies PublicUser;

describe("UsersWorkspace", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("shows persisted workspace members and adds a member through the API", async () => {
    render(<UsersWorkspace accessToken="token" currentUser={admin} />);
    expect(screen.getByText("Avery Admin")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Add user" }));
    fireEvent.change(screen.getByLabelText("First name"), { target: { value: "Jamie" } });
    fireEvent.change(screen.getByLabelText("Last name"), { target: { value: "Sales" } });
    fireEvent.change(screen.getByLabelText("Work email"), {
      target: { value: "jamie@example.local" }
    });
    fireEvent.change(screen.getByLabelText("Temporary password"), {
      target: { value: "SecurePassword123" }
    });
    const submitButtons = screen.getAllByRole("button", { name: /^Add user$/ });
    const submitButton = submitButtons.at(-1);
    if (!submitButton) throw new Error("Add user submit button was not rendered");
    fireEvent.click(submitButton);
    await waitFor(() =>
      expect(createUser).toHaveBeenCalledWith("token", {
        firstName: "Jamie",
        lastName: "Sales",
        email: "jamie@example.local",
        password: "SecurePassword123",
        role: "SALES_REP"
      })
    );
  });

  it("saves the selected role for a new team member", async () => {
    render(<UsersWorkspace accessToken="token" currentUser={admin} />);
    fireEvent.click(screen.getByRole("button", { name: "Add user" }));
    fireEvent.click(screen.getByRole("button", { name: "Role Sales representative" }));
    fireEvent.click(
      within(screen.getByRole("listbox", { name: "User role" })).getByRole("option", {
        name: "Sales manager"
      })
    );
    fireEvent.change(screen.getByLabelText("First name"), { target: { value: "Jamie" } });
    fireEvent.change(screen.getByLabelText("Last name"), { target: { value: "Sales" } });
    fireEvent.change(screen.getByLabelText("Work email"), {
      target: { value: "jamie@example.local" }
    });
    fireEvent.change(screen.getByLabelText("Temporary password"), {
      target: { value: "SecurePassword123" }
    });
    const submitButton = screen.getAllByRole("button", { name: "Add user" }).at(-1);
    if (!submitButton) throw new Error("Add user submit button was not rendered");
    fireEvent.click(submitButton);

    await waitFor(() =>
      expect(createUser).toHaveBeenCalledWith(
        "token",
        expect.objectContaining({ role: "SALES_MANAGER" })
      )
    );
  });
});
