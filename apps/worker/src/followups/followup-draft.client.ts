import { getWorkerConfig } from "@shilabs/shared-config";
import { PermanentDomainEventError } from "../domain-events/domain-event.errors.js";

export interface FollowUpDraftInput {
  workspaceId: string;
  attemptId: string;
}
export interface FollowUpDraft {
  subject: string;
  textBody: string;
}
export interface FollowUpWait { waitUntil: string }
export type PrepareFollowUpDraft = (input: FollowUpDraftInput) => Promise<FollowUpDraft | FollowUpWait>;

export async function requestFollowUpDraft(
  input: FollowUpDraftInput,
  env: NodeJS.ProcessEnv = process.env,
  request: typeof fetch = fetch
): Promise<FollowUpDraft | FollowUpWait> {
  const config = getWorkerConfig(env);
  if (!config.realtimeInternalSecret)
    throw new Error("Follow-up preparation requires an internal secret");
  const response = await request(
    `${config.apiBaseUrl.replace(/\/$/u, "")}/api/followups/internal/prepare`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-shilabs-realtime-secret": config.realtimeInternalSecret
      },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(90_000)
    }
  );
  if ([404, 409, 422].includes(response.status)) {
    throw new PermanentDomainEventError(
      "FOLLOW_UP_REVIEW_REQUIRED",
      "This follow-up was stopped for review or a change in lead status."
    );
  }
  if (!response.ok)
    throw new Error(`Follow-up preparation unavailable (${String(response.status)})`);
  const result: unknown = await response.json();
  if (result && typeof result === "object" && "waitUntil" in result && typeof result.waitUntil === "string" &&
      Number.isFinite(Date.parse(result.waitUntil))) return { waitUntil: result.waitUntil };
  if (
    !result ||
    typeof result !== "object" ||
    !("subject" in result) ||
    !("textBody" in result) ||
    typeof result.subject !== "string" ||
    !result.subject.trim() ||
    typeof result.textBody !== "string" ||
    !result.textBody.trim()
  ) {
    throw new Error("Follow-up preparation returned an invalid message");
  }
  return { subject: result.subject, textBody: result.textBody };
}
