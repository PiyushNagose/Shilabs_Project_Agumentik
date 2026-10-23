/**
 * @vitest-environment happy-dom
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PublicUser, ScoringConfigDto } from "@shilabs/shared-types";
import { SettingsWorkspace } from "./SettingsWorkspace.js";
import { updateOwnProfile, updateScoringConfig } from "../../services/api-client.js";

const config: ScoringConfigDto = {
  id: "scoring_1",
  key: "default",
  requirementWeight: 30,
  authorityWeight: 20,
  budgetWeight: 15,
  timelineWeight: 15,
  businessFitWeight: 20,
  warmThreshold: 35,
  hotThreshold: 70,
  createdAt: "2026-10-10T10:00:00.000Z",
  updatedAt: "2026-10-10T10:00:00.000Z"
};
vi.mock("../../hooks/usePersistedResource.js", () => ({
  usePersistedResource: (() => {
    const scoringData = {
      id: "scoring_1",
      key: "default",
      requirementWeight: 30,
      authorityWeight: 20,
      budgetWeight: 15,
      timelineWeight: 15,
      businessFitWeight: 20,
      warmThreshold: 35,
      hotThreshold: 70,
      createdAt: "2026-10-10T10:00:00.000Z",
      updatedAt: "2026-10-10T10:00:00.000Z"
    };
    const policyData: never[] = [];
    const reload = vi.fn();
    return (options: { scope: string }) => ({
      data: options.scope === "workspace-follow-up-policies" ? policyData : scoringData,
      loading: false,
      error: null,
      reload
    });
  })()
}));
vi.mock("../../services/api-client.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../services/api-client.js")>()),
  updateOwnProfile: vi.fn().mockResolvedValue({
    id: "admin_1",
    email: "admin@example.local",
    firstName: "Jamie",
    lastName: "Admin",
    role: "ADMIN",
    status: "ACTIVE",
    createdAt: "2026-10-10T10:00:00.000Z",
    updatedAt: "2026-10-10T10:00:00.000Z"
  }),
  updateScoringConfig: vi.fn().mockResolvedValue({
    id: "scoring_1",
    key: "default",
    requirementWeight: 30,
    authorityWeight: 20,
    budgetWeight: 15,
    timelineWeight: 15,
    businessFitWeight: 20,
    warmThreshold: 35,
    hotThreshold: 70,
    createdAt: "2026-10-10T10:00:00.000Z",
    updatedAt: "2026-10-10T10:00:00.000Z"
  })
}));

const admin = {
  id: "admin_1",
  email: "admin@example.local",
  firstName: "Avery",
  lastName: "Admin",
  role: "ADMIN",
  status: "ACTIVE",
  createdAt: config.createdAt,
  updatedAt: config.updatedAt
} satisfies PublicUser;

describe("SettingsWorkspace", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("persists account profile edits and lead prioritization rules", async () => {
    const onUserUpdated = vi.fn();
    render(
      <SettingsWorkspace accessToken="token" currentUser={admin} onUserUpdated={onUserUpdated} />
    );
    fireEvent.change(screen.getByLabelText("First name"), { target: { value: "Jamie" } });
    fireEvent.click(screen.getByRole("button", { name: "Save profile" }));
    await waitFor(() =>
      expect(updateOwnProfile).toHaveBeenCalledWith("token", {
        firstName: "Jamie",
        lastName: "Admin"
      })
    );
    await waitFor(() => expect(onUserUpdated).toHaveBeenCalled());

    fireEvent.change(screen.getByLabelText("Warm lead threshold"), { target: { value: "40" } });
    fireEvent.click(screen.getByRole("button", { name: "Save scoring rules" }));
    await waitFor(() =>
      expect(updateScoringConfig).toHaveBeenCalledWith(
        "token",
        expect.objectContaining({ warmThreshold: 40 })
      )
    );
    expect(screen.getByRole("heading", { name: "Automatic follow-up schedules" })).toBeTruthy();
  });

  it("refreshes profile fields when the authenticated user changes", () => {
    const { rerender } = render(
      <SettingsWorkspace accessToken="token" currentUser={admin} onUserUpdated={vi.fn()} />
    );
    rerender(
      <SettingsWorkspace
        accessToken="token"
        currentUser={{ ...admin, firstName: "Jamie", lastName: "Sales" }}
        onUserUpdated={vi.fn()}
      />
    );

    expect(screen.getByLabelText("First name")).toHaveProperty("value", "Jamie");
    expect(screen.getByLabelText("Last name")).toHaveProperty("value", "Sales");
  });
});
