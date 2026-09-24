import type React from "react";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { PublicUser } from "@shilabs/shared-types";
import { clearAuth, loadAuth, saveAuth } from "./auth-storage.js";
import { AuthApiError, loginRequest, logoutRequest, meRequest } from "./auth-api.js";

type AuthStatus = "checking" | "authenticated" | "unauthenticated" | "unavailable";

interface AuthState {
  accessToken: string | null;
  user: PublicUser | null;
  status: AuthStatus;
}

interface AuthContextValue {
  accessToken: string | null;
  user: PublicUser | null;
  status: AuthStatus;
  retryAuthValidation: () => Promise<void>;
  login: (input: { email: string; password: string }) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [auth, setAuth] = useState<AuthState>(() => {
    const stored = loadAuth();
    if (!stored) {
      return { accessToken: null, user: null, status: "unauthenticated" };
    }

    return { accessToken: stored.accessToken, user: null, status: "checking" };
  });

  const validateStoredAuth = useCallback(async (): Promise<void> => {
    const stored = loadAuth();
    if (!stored) {
      setAuth({ accessToken: null, user: null, status: "unauthenticated" });
      return;
    }

    setAuth({ accessToken: stored.accessToken, user: null, status: "checking" });
    try {
      const user = await meRequest(stored.accessToken);
      const refreshed = { accessToken: stored.accessToken, user };
      saveAuth(refreshed);
      setAuth({ ...refreshed, status: "authenticated" });
    } catch (error) {
      if (error instanceof AuthApiError && error.status === 401) {
        clearAuth();
        setAuth({ accessToken: null, user: null, status: "unauthenticated" });
        return;
      }

      setAuth({ accessToken: stored.accessToken, user: null, status: "unavailable" });
    }
  }, []);

  useEffect(() => {
    if (auth.status === "checking") {
      void validateStoredAuth();
    }
  }, [auth.status, validateStoredAuth]);

  useEffect(() => {
    function handleAuthInvalid(): void {
      clearAuth();
      setAuth({ accessToken: null, user: null, status: "unauthenticated" });
    }

    window.addEventListener("shilabs:auth-invalid", handleAuthInvalid);
    return () => window.removeEventListener("shilabs:auth-invalid", handleAuthInvalid);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      accessToken: auth.accessToken,
      user: auth.user,
      status: auth.status,
      retryAuthValidation: validateStoredAuth,
      async login(input) {
        const response = await loginRequest(input);
        saveAuth(response);
        setAuth({ ...response, status: "authenticated" });
      },
      async logout() {
        if (auth.accessToken) {
          await logoutRequest(auth.accessToken).catch(() => undefined);
        }
        clearAuth();
        setAuth({ accessToken: null, user: null, status: "unauthenticated" });
      }
    }),
    [auth, validateStoredAuth]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error("useAuth must be used inside AuthProvider");
  }

  return value;
}
