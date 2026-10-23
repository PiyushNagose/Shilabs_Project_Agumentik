/**
 * @vitest-environment happy-dom
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CompaniesWorkspace } from "./CompaniesWorkspace.js";

const data = {
  companies: [
    { id: "older", name: "Alpha Systems", createdAt: "2026-10-01T10:00:00Z" },
    { id: "newer", name: "Zeta Systems", createdAt: "2026-10-21T10:00:00Z" },
    { id: "middle", name: "Beta Systems", createdAt: "2026-10-10T10:00:00Z" }
  ],
  contacts: [],
  leads: []
};

vi.mock("../../hooks/usePersistedResource.js", () => ({
  usePersistedResource: ({ scope }: { scope: string }) => ({
    data: scope.startsWith("companies:") ? data : null,
    loading: false,
    error: null,
    reload: vi.fn()
  })
}));

afterEach(cleanup);

describe("Companies sorting", () => {
  it("defaults to newest first in both grid and list views", () => {
    render(<CompaniesWorkspace accessToken="test" onOpenLead={vi.fn()} />);
    const names = () =>
      screen.getAllByRole("heading", { level: 3 }).map((node) => node.textContent);
    expect(screen.getByLabelText<HTMLSelectElement>("Sort companies").value).toBe("recent");
    expect(names()).toEqual(["Zeta Systems", "Beta Systems", "Alpha Systems"]);
    fireEvent.click(screen.getByRole("button", { name: "List view" }));
    expect(names()).toEqual(["Zeta Systems", "Beta Systems", "Alpha Systems"]);
  });

  it("still supports alphabetical sorting", () => {
    render(<CompaniesWorkspace accessToken="test" onOpenLead={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Sort companies"), { target: { value: "name" } });
    expect(screen.getAllByRole("heading", { level: 3 }).map((node) => node.textContent)).toEqual([
      "Alpha Systems",
      "Beta Systems",
      "Zeta Systems"
    ]);
  });
});
