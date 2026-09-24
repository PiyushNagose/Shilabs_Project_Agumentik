import type { AuthResponse, PublicUser } from "@shilabs/shared-types";

const viteEnv = import.meta.env as Readonly<Record<string, string | undefined>>;
const apiBaseUrl = viteEnv.VITE_API_BASE_URL ?? "http://localhost:4000";

export class AuthApiError extends Error {
  public constructor(
    message: string,
    public readonly status: number | null
  ) {
    super(message);
  }
}

export async function loginRequest(input: {
  email: string;
  password: string;
}): Promise<AuthResponse> {
  const response = await fetch(`${apiBaseUrl}/api/auth/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(input)
  });

  if (!response.ok) {
    throw new Error("Login failed");
  }

  return (await response.json()) as AuthResponse;
}

export async function meRequest(accessToken: string): Promise<PublicUser> {
  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl}/api/auth/me`, {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    });
  } catch {
    throw new AuthApiError("Authentication service unavailable", null);
  }

  if (response.status === 401) {
    throw new AuthApiError("Stored session is invalid", 401);
  }

  if (!response.ok) {
    throw new AuthApiError("Authentication validation failed", response.status);
  }

  return (await response.json()) as PublicUser;
}

export async function logoutRequest(accessToken: string): Promise<void> {
  await fetch(`${apiBaseUrl}/api/auth/logout`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });
}
