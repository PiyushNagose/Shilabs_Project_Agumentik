import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiClientError, apiRequest } from "./core.js";

describe("API client errors", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("loads CRM records from the authenticated API", async () => {
    const fetchRequest = vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify([]), { status: 200 }))
    );
    vi.stubGlobal("fetch", fetchRequest);

    await expect(apiRequest("/api/companies", "session-token")).resolves.toEqual([]);
    expect(fetchRequest).toHaveBeenCalledOnce();
    const request = fetchRequest.mock.calls[0] as unknown as [string, RequestInit];
    expect(request[0]).toContain("/api/companies");
    expect(new Headers(request[1].headers).get("Authorization")).toBe("Bearer session-token");
  });

  it("reports an unavailable API without substituting sample records", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new TypeError("Network unavailable"))));

    await expect(apiRequest("/api/leads", "session-token")).rejects.toThrow("Network unavailable");
  });

  it("preserves safe nested API error messages and codes", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              error: { code: "AUTHORIZATION_ERROR", message: "Manager access is required" }
            }),
            { status: 403, headers: { "Content-Type": "application/json" } }
          )
        )
      )
    );

    const error = await apiRequest("/api/protected", "token").catch((value: unknown) => value);
    expect(error).toBeInstanceOf(ApiClientError);
    expect(error).toMatchObject({
      message: "Manager access is required",
      status: 403,
      code: "AUTHORIZATION_ERROR"
    });
  });

  it("accepts successful responses without a body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response(null, { status: 204 })))
    );

    await expect(
      apiRequest<undefined>("/api/resource/1", "token", { method: "DELETE" })
    ).resolves.toBe(undefined);
  });
});
