import { describe, expect, it, vi } from "vitest";
import { requestFollowUpDraft } from "./followup-draft.client.js";

const env = {
  WORKER_API_BASE_URL: "http://localhost:4010",
  REALTIME_INTERNAL_SECRET: "internal-test-secret"
};
const input = { workspaceId: "workspace-a", attemptId: "attempt-a" };

describe("follow-up draft preparation", () => {
  it("uses the authenticated internal API and validates fresh content", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ subject: "Updated scope", textBody: "Current approved scope." })
        )
      );
    await expect(requestFollowUpDraft(input, env, request)).resolves.toEqual({
      subject: "Updated scope",
      textBody: "Current approved scope."
    });
    expect(request).toHaveBeenCalledWith(
      "http://localhost:4010/api/followups/internal/prepare",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify(input),
        headers: {
          "Content-Type": "application/json",
          "x-shilabs-realtime-secret": "internal-test-secret"
        }
      })
    );
  });
  it("fails closed when preparation requires human attention", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 422 }));
    await expect(requestFollowUpDraft(input, env, request)).rejects.toMatchObject({
      code: "FOLLOW_UP_REVIEW_REQUIRED"
    });
  });
  it("does not substitute old content when the API fails or returns malformed content", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ textBody: "" })));
    await expect(requestFollowUpDraft(input, env, request)).rejects.toThrow("unavailable");
    await expect(requestFollowUpDraft(input, env, request)).rejects.toThrow("invalid message");
  });
});
