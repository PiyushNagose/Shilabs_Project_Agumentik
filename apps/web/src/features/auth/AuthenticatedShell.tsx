import type React from "react";
import { useEffect, useState } from "react";
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

const routeByView: Record<ShellView, string> = {
  Dashboard: "/dashboard",
  CRM: "/crm",
  Operations: "/operations",
  Users: "/users",
  Settings: "/settings",
  Team: "/team",
  Reports: "/reports",
  "My Workspace": "/workspace"
};

function isDetailTab(value: string | null): value is DetailTab {
  return (
    value === "Overview" ||
    value === "Conversation" ||
    value === "Qualification" ||
    value === "Proposals" ||
    value === "Activities" ||
    value === "Meetings" ||
    value === "Deal" ||
    value === "AI Insights"
  );
}

function parseRoute(navItems: readonly NavItem[]): {
  view: ShellView;
  leadId: string | null;
  tab?: DetailTab;
} {
  const path = window.location.pathname;
  const params = new URLSearchParams(window.location.search);
  const tabParam = params.get("tab");
  const firstAllowedView = navItems[0]?.label ?? "Dashboard";
  const canOpen = (view: ShellView) => navItems.some((item) => item.label === view);

  if (path.startsWith("/crm/leads/") && canOpen("CRM")) {
    return {
      view: "CRM",
      leadId: decodeURIComponent(path.slice("/crm/leads/".length)),
      tab: isDetailTab(tabParam) ? tabParam : undefined
    };
  }

  if (path === "/crm" && canOpen("CRM")) return { view: "CRM", leadId: null };
  if (path === "/workspace" && canOpen("My Workspace")) return { view: "My Workspace", leadId: null };
  if (path === "/operations" && canOpen("Operations")) return { view: "Operations", leadId: null };
  if (path === "/users" && canOpen("Users")) return { view: "Users", leadId: null };
  if (path === "/settings" && canOpen("Settings")) return { view: "Settings", leadId: null };
  if (path === "/team" && canOpen("Team")) return { view: "Team", leadId: null };
  if (path === "/reports" && canOpen("Reports")) return { view: "Reports", leadId: null };
  return { view: canOpen("Dashboard") ? "Dashboard" : firstAllowedView, leadId: null };
}

function routeFor(input: { view: ShellView; leadId?: string | null; tab?: DetailTab }): string {
  if ((input.view === "CRM" || input.view === "My Workspace") && input.leadId) {
    const params = new URLSearchParams();
    if (input.tab) params.set("tab", input.tab);
    const query = params.toString();
    return `/crm/leads/${encodeURIComponent(input.leadId)}${query ? `?${query}` : ""}`;
  }
  return routeByView[input.view];
}

export function AuthenticatedShell(): React.JSX.Element {
  const { accessToken, user, logout } = useAuth();
  const role = user?.role ?? "SALES_REP";
  const navItems = navigationByRole[role];
  const [routeState, setRouteState] = useState(() => parseRoute(navItems));
  const activeView = routeState.view;
  const [workspaceTarget, setWorkspaceTarget] = useState<{
    leadId: string | null;
    tab?: DetailTab;
  }>({ leadId: routeState.leadId, tab: routeState.tab });

  function navigate(input: { view: ShellView; leadId?: string | null; tab?: DetailTab }): void {
    const nextRoute = {
      view: input.view,
      leadId: input.leadId ?? null,
      tab: input.tab
    };
    window.history.pushState(null, "", routeFor(nextRoute));
    setRouteState(nextRoute);
    setWorkspaceTarget({ leadId: nextRoute.leadId, tab: nextRoute.tab });
  }

  useEffect(() => {
    const applyRoute = (): void => {
      const nextRoute = parseRoute(navigationByRole[role]);
      setRouteState(nextRoute);
      setWorkspaceTarget({ leadId: nextRoute.leadId, tab: nextRoute.tab });
    };
    applyRoute();
    window.addEventListener("popstate", applyRoute);
    return () => window.removeEventListener("popstate", applyRoute);
  }, [role]);

  if (!user || !accessToken) {
    throw new Error("AuthenticatedShell requires a logged-in user");
  }

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
            href={routeFor({ view: item.label })}
            key={item.label}
            onClick={(event) => {
              event.preventDefault();
              navigate({ view: item.label });
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
            navigate({ view: "CRM", leadId, tab });
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
          onRouteChange={(leadId, tab) => navigate({ view: "CRM", leadId, tab })}
        />
      ) : (
        <section className="crm-workspace">
          <div className="workspace-panel reserved-workspace">
            <div className="state-block" role="status">
              <strong>{activeView} is reserved for live platform data</strong>
              <span>This milestone does not expose that workflow yet, so no demo or fake runtime data is shown.</span>
            </div>
          </div>
        </section>
      )}
    </main>
  );
}
