import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiClientError, apiRequest } from "./core.js";

describe("API client errors", () => {
  afterEach(() => vi.unstubAllGlobals());

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
});
