/**
 * @vitest-environment happy-dom
 */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OrdersWorkspace } from "./OrdersWorkspace.js";

const companies = [
  { id: "older", name: "Aurevia Industrial Systems Pvt Ltd", website: "older.example" },
  { id: "newer", name: "Meridian Crest Automation RUN", website: "meridian.example" },
  { id: "duplicate", name: "Aurevia Industrial Systems Pvt Ltd", website: "duplicate.example" },
  { id: "standalone", name: "A standalone company", website: null }
];
const contacts = companies.map((company) => ({
  id: `contact_${company.id}`,
  companyId: company.id,
  firstName: company.id === "newer" ? "Kavya" : "Other",
  lastName: "Deshmukh",
  email: `${company.id}@example.test`
}));
function deal(companyId: string, updatedAt: string, status = "WON", id = companyId) {
  return {
    id,
    status,
    updatedAt,
    ownerId: "owner",
    currency: "INR",
    value: "1850000",
    stage: { label: status === "WON" ? "Won" : "New" },
    lead: {
      companyId,
      contactId: `contact_${companyId}`,
      contact: contacts.find((contact) => contact.companyId === companyId)
    }
  };
}
const data = {
  companies,
  contacts,
  deals: [
    deal("older", "2026-10-10T10:00:00Z"),
    deal("newer", "2026-10-21T10:00:00Z"),
    deal("duplicate", "2026-10-11T10:00:00Z"),
    deal("newer", "2026-10-22T10:00:00Z", "OPEN", "newer_open")
  ],
  users: [{ id: "owner", firstName: "Development", lastName: "Admin" }],
  orders: [],
  total: 0,
  totalPages: 1,
  summary: {
    totalOrders: 0,
    unfulfilled: 0,
    processing: 0,
    fulfilledToday: 0,
    revenueToday: "0",
    averageOrderValue: "0",
    currency: "INR"
  }
};

vi.mock("../../hooks/usePersistedResource.js", () => ({
  usePersistedResource: ({ scope }: { scope: string }) => ({
    data: scope.startsWith("orders:") ? data : null,
    loading: false,
    error: null,
    reload: vi.fn()
  })
}));

afterEach(cleanup);

describe("order record options", () => {
  it("shows recently updated won companies first with separate, readable details", async () => {
    render(<OrdersWorkspace accessToken="test" initialOrderId={null} onRouteChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "New order" }));
    const dialog = within(screen.getByRole("dialog"));
    fireEvent.click(dialog.getByRole("button", { name: /Select a company$/ }));
    const options = within(
      await dialog.findByRole("listbox", { name: "Order company" })
    ).getAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual([
      "Select a company",
      "Meridian Crest Automation RUNWon deal",
      "Aurevia Industrial Systems Pvt LtdWon deal - duplicate.example",
      "Aurevia Industrial Systems Pvt LtdWon deal - older.example",
      "A standalone company"
    ]);
    expect(options[1]?.querySelector(".themed-select-option-copy small")?.textContent).toBe(
      "Won deal"
    );
  });

  it("keeps the selected company linked to its won deal, contact, owner and currency", async () => {
    render(<OrdersWorkspace accessToken="test" initialOrderId={null} onRouteChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "New order" }));
    const dialog = within(screen.getByRole("dialog"));
    fireEvent.click(dialog.getByRole("button", { name: /Select a company$/ }));
    fireEvent.click(
      await dialog.findByRole("option", { name: "Meridian Crest Automation RUN - Won deal" })
    );
    for (const [label, value] of [
      ["Order company", "newer"],
      ["Order contact", "contact_newer"],
      ["Related deal", "newer"],
      ["Order owner", "owner"]
    ] as const) {
      expect((dialog.getByLabelText<HTMLSelectElement>(label)).value).toBe(value);
    }
    expect(dialog.getByLabelText<HTMLInputElement>("Order currency").value).toBe("INR");
    fireEvent.click(dialog.getByRole("button", { name: "Deal Kavya Deshmukh" }));
    const dealOptions = within(
      await dialog.findByRole("listbox", { name: "Related deal" })
    ).getAllByRole("option");
    expect(dealOptions[0]?.textContent).toContain("Won");
    expect(dealOptions[1]?.textContent).toContain("New");
  });
});
