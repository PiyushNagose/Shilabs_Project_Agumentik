import type React from "react";
import type { UserRoleName } from "@shilabs/shared-types";
import { useAuth } from "./AuthProvider.js";

const navigationByRole: Record<UserRoleName, readonly string[]> = {
  ADMIN: ["Users", "Settings"],
  SALES_MANAGER: ["Team", "Reports"],
  SALES_REP: ["My Workspace"]
};

export function AuthenticatedShell(): React.JSX.Element {
  const { user, logout } = useAuth();

  if (!user) {
    throw new Error("AuthenticatedShell requires a logged-in user");
  }

  return (
    <main className="authenticated-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Signed in</p>
          <h1>Shilabs AI Sales Engine</h1>
        </div>
        <div className="user-menu">
          <span>{`${user.firstName} ${user.lastName}`}</span>
          <button onClick={() => void logout()} type="button">
            Logout
          </button>
        </div>
      </header>
      <nav aria-label="Primary">
        {navigationByRole[user.role].map((item) => (
          <a href="/" key={item} onClick={(event) => event.preventDefault()}>
            {item}
          </a>
        ))}
      </nav>
      <section className="access-summary" aria-labelledby="access-title">
        <h2 id="access-title">Access Ready</h2>
        <p>{user.role.replace("_", " ")} permissions are active for this account.</p>
      </section>
    </main>
  );
}
