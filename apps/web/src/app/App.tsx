import type React from "react";
import { AuthenticatedShell } from "../features/auth/AuthenticatedShell.js";
import { AuthProvider, useAuth } from "../features/auth/AuthProvider.js";
import { LoginPage } from "../features/auth/LoginPage.js";

export function App(): React.JSX.Element {
  return (
    <AuthProvider>
      <AuthGate />
    </AuthProvider>
  );
}

function AuthGate(): React.JSX.Element {
  const { user } = useAuth();

  if (user) {
    return <AuthenticatedShell />;
  }

  return <LoginPage />;
}
