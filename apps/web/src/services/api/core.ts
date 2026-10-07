const viteEnv = import.meta.env as Readonly<Record<string, string | undefined>>;
export const apiBaseUrl = viteEnv.VITE_API_BASE_URL ?? "http://localhost:4000";
const bypassNgrokWarning = viteEnv.VITE_NGROK_BYPASS_WARNING === "true";

export function apiHeaders(initial?: HeadersInit): Headers {
  const headers = new Headers(initial);
  if (bypassNgrokWarning) headers.set("ngrok-skip-browser-warning", "true");
  return headers;
}

export class ApiClientError extends Error {
  public constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string
  ) {
    super(message);
  }
}

export function apiErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiClientError && error.message.trim().length > 0) return error.message;
  return fallback;
}

function isErrorPayload(value: unknown): value is { message?: unknown; code?: unknown } {
  return typeof value === "object" && value !== null;
}

function notifyAuthInvalid(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event("shilabs:auth-invalid"));
}

export async function apiRequest<TResponse>(
  path: string,
  accessToken: string,
  init: RequestInit = {}
): Promise<TResponse> {
  const headers = apiHeaders(init.headers);
  headers.set("Content-Type", "application/json");
  headers.set("Authorization", `Bearer ${accessToken}`);
  const response = await fetch(`${apiBaseUrl}${path}`, { ...init, headers });

  if (!response.ok) {
    if (response.status === 401) notifyAuthInvalid();
    let message = "Request failed";
    let code: string | undefined;
    try {
      const payload: unknown = await response.json();
      if (isErrorPayload(payload)) {
        if (typeof payload.message === "string" && payload.message.trim())
          message = payload.message;
        if (typeof payload.code === "string" && payload.code.trim()) code = payload.code;
      }
    } catch {
      // Preserve the safe fallback for non-JSON failures.
    }
    throw new ApiClientError(message, response.status, code);
  }

  return (await response.json()) as TResponse;
}
