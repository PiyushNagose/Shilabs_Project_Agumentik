import type React from "react";
import { Icon } from "../components/Icon.js";
import { StateBlock } from "../components/StateBlock.js";
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
  const { retryAuthValidation, status, user } = useAuth();

  if (status === "authenticated" && user) {
    return <AuthenticatedShell />;
  }

  if (status === "checking") {
    return (
      <main className="login-page">
        <section className="login-panel" aria-live="polite">
          <StateBlock title="Checking session" detail="Validating your saved sign-in." />
        </section>
      </main>
    );
  }

  if (status === "unavailable") {
    return (
      <main className="login-page">
        <section className="login-panel" aria-live="polite">
          <StateBlock
            title="Service unavailable"
            detail="Your saved session is preserved. Retry once the API is back online."
            action={
              <button onClick={() => void retryAuthValidation()} type="button">
                <Icon name="refresh" size={16} />
                Retry
              </button>
            }
          />
        </section>
      </main>
    );
  }

  return <LoginPage />;
}
