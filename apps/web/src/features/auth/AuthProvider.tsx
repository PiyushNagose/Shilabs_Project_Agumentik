import type React from "react";
import { createContext, useContext, useMemo, useState } from "react";
import type { PublicUser } from "@shilabs/shared-types";
import { clearAuth, loadAuth, saveAuth } from "./auth-storage.js";
import { loginRequest, logoutRequest } from "./auth-api.js";

interface AuthContextValue {
  accessToken: string | null;
  user: PublicUser | null;
  login: (input: { email: string; password: string }) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [auth, setAuth] = useState(loadAuth);

  const value = useMemo<AuthContextValue>(
    () => ({
      accessToken: auth?.accessToken ?? null,
      user: auth?.user ?? null,
      async login(input) {
        const response = await loginRequest(input);
        saveAuth(response);
        setAuth(response);
      },
      async logout() {
        if (auth?.accessToken) {
          await logoutRequest(auth.accessToken).catch(() => undefined);
        }
        clearAuth();
        setAuth(null);
      }
    }),
    [auth]
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
