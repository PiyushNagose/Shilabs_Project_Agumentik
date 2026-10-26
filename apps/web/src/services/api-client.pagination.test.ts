import { afterEach, expect, it, vi } from "vitest";
import { listAllLeads } from "./api-client.js";

afterEach(() => vi.restoreAllMocks());

it("loads every page for company and contact relationships, preserving filters", async () => {
  const pages: number[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
    if (typeof input !== "string") throw new Error("Expected the API client to provide a URL string");
    const url = new URL(input);
    const page = Number(url.searchParams.get("page"));
    pages.push(page);
    expect(url.searchParams.get("ownerId")).toBe("owner-1");
    return Promise.resolve(new Response(JSON.stringify({ items: [{ id: `lead-${String(page)}` }], page, pageSize: 100, total: 3, totalPages: 3 })));
  });
  expect((await listAllLeads("token", { ownerId: "owner-1" })).map(lead => lead.id)).toEqual(["lead-1", "lead-2", "lead-3"]);
  expect(pages).toEqual([1, 2, 3]);
});

it("does not present a partial relationship list as a successful complete load", async () => {
  vi.spyOn(globalThis, "fetch")
    .mockResolvedValueOnce(new Response(JSON.stringify({ items: [{ id: "first" }], totalPages: 2 })))
    .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "Later page unavailable" } }), { status: 503 }));
  await expect(listAllLeads("token")).rejects.toThrow("Later page unavailable");
});
