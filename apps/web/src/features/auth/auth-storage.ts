import type { PublicUser } from "@shilabs/shared-types";

const accessTokenKey = "shilabs.accessToken";
const userKey = "shilabs.user";

export interface StoredAuth {
  accessToken: string;
  user: PublicUser;
}

function hasStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

export function saveAuth(auth: StoredAuth): void {
  if (!hasStorage()) {
    return;
  }

  window.localStorage.setItem(accessTokenKey, auth.accessToken);
  window.localStorage.setItem(userKey, JSON.stringify(auth.user));
}

export function loadAuth(): StoredAuth | null {
  if (!hasStorage()) {
    return null;
  }

  const accessToken = window.localStorage.getItem(accessTokenKey);
  const rawUser = window.localStorage.getItem(userKey);
  if (!accessToken || !rawUser) {
    return null;
  }

  try {
    return {
      accessToken,
      user: JSON.parse(rawUser) as PublicUser
    };
  } catch {
    clearAuth();
    return null;
  }
}

export function clearAuth(): void {
  if (!hasStorage()) {
    return;
  }

  window.localStorage.removeItem(accessTokenKey);
  window.localStorage.removeItem(userKey);
}
