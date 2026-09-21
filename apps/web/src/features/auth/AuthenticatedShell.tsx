import type React from "react";
import type { UserRoleName } from "@shilabs/shared-types";
import { CrmWorkspace } from "../leads/CrmWorkspace.js";
import { useAuth } from "./AuthProvider.js";

const navigationByRole: Record<UserRoleName, readonly string[]> = {
  ADMIN: ["CRM", "Users", "Settings"],
  SALES_MANAGER: ["CRM", "Team", "Reports"],
  SALES_REP: ["CRM", "My Workspace"]
};

export function AuthenticatedShell(): React.JSX.Element {
  const { accessToken, user, logout } = useAuth();

  if (!user || !accessToken) {
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
        <h2 id="access-title">Sales Workspace</h2>
        <p>{user.role.replace("_", " ")} permissions are active for this account.</p>
      </section>
      <CrmWorkspace accessToken={accessToken} currentUser={user} />
    </main>
  );
}
