import type { AuthResponse } from "@shilabs/shared-types";

const viteEnv = import.meta.env as Readonly<Record<string, string | undefined>>;
const apiBaseUrl = viteEnv.VITE_API_BASE_URL ?? "http://localhost:4000";

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

export async function logoutRequest(accessToken: string): Promise<void> {
  await fetch(`${apiBaseUrl}/api/auth/logout`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });
}
