import type React from "react";
import { useState } from "react";
import type { UserRoleName } from "@shilabs/shared-types";
import { Icon } from "../../components/Icon.js";
import { SalesActionDashboard } from "../dashboard/SalesActionDashboard.js";
import { CrmWorkspace, type DetailTab } from "../leads/CrmWorkspace.js";
import { OperationsDashboard } from "../operations/OperationsDashboard.js";
import { useAuth } from "./AuthProvider.js";

type NavIcon = "bar-chart" | "briefcase" | "settings" | "users";
type ShellView =
  | "Dashboard"
  | "CRM"
  | "Operations"
  | "Users"
  | "Settings"
  | "Team"
  | "Reports"
  | "My Workspace";

interface NavItem {
  label: ShellView;
  icon: NavIcon;
}

const navigationByRole: Record<UserRoleName, readonly NavItem[]> = {
  ADMIN: [
    { label: "Dashboard", icon: "briefcase" },
    { label: "CRM", icon: "bar-chart" },
    { label: "Operations", icon: "settings" },
    { label: "Users", icon: "users" },
    { label: "Settings", icon: "settings" }
  ],
  SALES_MANAGER: [
    { label: "Dashboard", icon: "briefcase" },
    { label: "CRM", icon: "bar-chart" },
    { label: "Operations", icon: "settings" },
    { label: "Team", icon: "users" },
    { label: "Reports", icon: "bar-chart" }
  ],
  SALES_REP: [
    { label: "Dashboard", icon: "briefcase" },
    { label: "CRM", icon: "bar-chart" },
    { label: "My Workspace", icon: "briefcase" }
  ]
};

function getInitials(firstName: string, lastName: string): string {
  return `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase();
}

function viewTitle(view: ShellView): string {
  if (view === "Dashboard") return "Sales Engineer Action Dashboard";
  if (view === "Operations") return "Operations Dashboard";
  return "Sales Workspace";
}

export function AuthenticatedShell(): React.JSX.Element {
  const { accessToken, user, logout } = useAuth();
  const [activeView, setActiveView] = useState<ShellView>("Dashboard");
  const [workspaceTarget, setWorkspaceTarget] = useState<{
    leadId: string | null;
    tab?: DetailTab;
  }>({ leadId: null });

  if (!user || !accessToken) {
    throw new Error("AuthenticatedShell requires a logged-in user");
  }

  const navItems = navigationByRole[user.role];

  return (
    <main className="authenticated-shell">
      <header className="topbar">
        <div className="topbar-brand">
          <div className="app-mark" aria-hidden="true">
            <Icon name="sparkles" size={18} />
          </div>
          <div>
            <p className="eyebrow">Shilabs Platform</p>
            <h1>AI Sales Engine</h1>
          </div>
        </div>
        <div className="user-menu">
          <div className="user-avatar" aria-hidden="true">
            {getInitials(user.firstName, user.lastName)}
          </div>
          <span className="user-name">{`${user.firstName} ${user.lastName}`}</span>
          <button onClick={() => void logout()} type="button">
            <Icon name="log-out" size={16} />
            Logout
          </button>
        </div>
      </header>
      <nav aria-label="Primary">
        {navItems.map((item) => (
          <a
            className={activeView === item.label ? "active-nav" : ""}
            href="/"
            key={item.label}
            onClick={(event) => {
              event.preventDefault();
              setActiveView(item.label);
            }}
          >
            <span className="nav-icon" aria-hidden="true">
              <Icon name={item.icon} size={16} />
            </span>
            {item.label}
          </a>
        ))}
      </nav>
      <section className="access-summary" aria-labelledby="access-title">
        <h2 id="access-title">{viewTitle(activeView)}</h2>
        <p>{user.role.replace("_", " ")} permissions are active for this account.</p>
      </section>
      {activeView === "Dashboard" ? (
        <SalesActionDashboard
          accessToken={accessToken}
          onOpenLead={(leadId, tab) => {
            setWorkspaceTarget({ leadId, tab });
            setActiveView("CRM");
          }}
        />
      ) : activeView === "Operations" ? (
        <OperationsDashboard accessToken={accessToken} />
      ) : activeView === "CRM" || activeView === "My Workspace" ? (
        <CrmWorkspace
          accessToken={accessToken}
          currentUser={user}
          initialLeadId={workspaceTarget.leadId}
          initialTab={workspaceTarget.tab}
        />
      ) : (
        <section className="crm-workspace">
          <div className="workspace-panel">
            <div className="state-block" role="status">
              <strong>{activeView} comes in a later milestone</strong>
              <span>This view is reserved without fake runtime data.</span>
            </div>
          </div>
        </section>
      )}
    </main>
  );
}
