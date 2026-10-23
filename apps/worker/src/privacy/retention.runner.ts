import { getWorkerConfig } from "@shilabs/shared-config";

export async function runRetentionCleanup(
  env: NodeJS.ProcessEnv = process.env,
  request: typeof fetch = fetch
): Promise<void> {
  const config = getWorkerConfig(env);
  if (env.NODE_ENV === "production" && !config.realtimeInternalSecret) {
    throw new Error("A configured internal secret is required for retention cleanup");
  }
  const response = await request(
    `${config.apiBaseUrl.replace(/\/$/u, "")}/api/privacy/internal/run-due`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-shilabs-realtime-secret": config.realtimeInternalSecret
      },
      signal: AbortSignal.timeout(300000)
    }
  );
  if (!response.ok) throw new Error(`Retention cleanup failed (${String(response.status)})`);
  const result = (await response.json()) as { results?: { failed?: boolean }[] };
  if (result.results?.some((item) => item.failed))
    throw new Error("A workspace retention cleanup requires attention");
}
