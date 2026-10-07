import type { UserRoleName } from "@shilabs/shared-types";
import type { LucideIcon } from "lucide-react";
import { BarChart3, BriefcaseBusiness, Building2, ContactRound, Handshake, LayoutDashboard, Settings, Users } from "lucide-react";
import type { DetailTab } from "../features/leads/CrmWorkspace.js";

export type AppRouteId =
  "dashboard" | "crm" | "deals" | "contacts" | "companies" | "operations" | "users" | "settings" | "team" | "reports" | "workspace";

export interface AppRouteDefinition {
  id: AppRouteId;
  label: string;
  title: string;
  path: string;
  icon: LucideIcon;
}

export interface AppRouteState {
  id: AppRouteId;
  leadId: string | null;
  dealId?: string | null;
  tab?: DetailTab;
}

export const appRoutes: Readonly<Record<AppRouteId, AppRouteDefinition>> = {
  dashboard: {
    id: "dashboard",
    label: "Dashboard",
    title: "Sales Engineer Action Dashboard",
    path: "/dashboard",
    icon: LayoutDashboard
  },
  crm: {
    id: "crm",
    label: "CRM",
    title: "Sales Workspace",
    path: "/crm",
    icon: BarChart3
  },
  deals: {
    id: "deals",
    label: "Deals",
    title: "Deals & Pipelines",
    path: "/deals",
    icon: Handshake
  },
  contacts: {
    id: "contacts",
    label: "Contacts",
    title: "Lead Contacts",
    path: "/contacts",
    icon: ContactRound
  },
  companies: {
    id: "companies",
    label: "Companies",
    title: "Companies",
    path: "/companies",
    icon: Building2
  },
  operations: {
    id: "operations",
    label: "Operations",
    title: "Operations Dashboard",
    path: "/operations",
    icon: Settings
  },
  users: {
    id: "users",
    label: "Users",
    title: "Users",
    path: "/users",
    icon: Users
  },
  settings: {
    id: "settings",
    label: "Settings",
    title: "Settings",
    path: "/settings",
    icon: Settings
  },
  team: {
    id: "team",
    label: "Team",
    title: "Team",
    path: "/team",
    icon: Users
  },
  reports: {
    id: "reports",
    label: "Reports",
    title: "Reports",
    path: "/reports",
    icon: BarChart3
  },
  workspace: {
    id: "workspace",
    label: "My Workspace",
    title: "Sales Workspace",
    path: "/workspace",
    icon: BriefcaseBusiness
  }
};

export const navigationByRole: Readonly<Record<UserRoleName, readonly AppRouteId[]>> = {
  ADMIN: ["dashboard", "crm", "deals", "contacts", "companies", "operations", "users", "settings"],
  SALES_MANAGER: ["dashboard", "crm", "deals", "contacts", "companies", "operations", "team", "reports"],
  SALES_REP: ["dashboard", "crm", "deals", "contacts", "companies", "workspace"]
};

function isDetailTab(value: string | null): value is DetailTab {
  return (
    value === "Overview" ||
    value === "Conversation" ||
    value === "Qualification" ||
    value === "Proposals" ||
    value === "Activities" ||
    value === "Tasks" ||
    value === "Meetings" ||
    value === "Deal" ||
    value === "AI Insights"
  );
}

export function parseAppRoute(allowedRoutes: readonly AppRouteId[]): AppRouteState {
  const path = window.location.pathname;
  const firstAllowedRoute = allowedRoutes[0] ?? "dashboard";
  const canOpen = (id: AppRouteId): boolean => allowedRoutes.includes(id);

  if (path.startsWith("/crm/leads/") && canOpen("crm")) {
    const tab = new URLSearchParams(window.location.search).get("tab");
    return {
      id: "crm",
      leadId: decodeURIComponent(path.slice("/crm/leads/".length)),
      tab: isDetailTab(tab) ? tab : undefined
    };
  }

  if (path.startsWith("/deals/") && canOpen("deals")) {
    return { id: "deals", leadId: null, dealId: decodeURIComponent(path.slice("/deals/".length)) };
  }

  const route = Object.values(appRoutes).find(
    (candidate) => candidate.path === path && canOpen(candidate.id)
  );
  return { id: route?.id ?? firstAllowedRoute, leadId: null };
}

export function appPath(input: AppRouteState): string {
  if (input.id === "deals" && input.dealId) return `/deals/${encodeURIComponent(input.dealId)}`;
  if ((input.id === "crm" || input.id === "workspace") && input.leadId) {
    const params = new URLSearchParams();
    if (input.tab) params.set("tab", input.tab);
    const query = params.toString();
    return `/crm/leads/${encodeURIComponent(input.leadId)}${query ? `?${query}` : ""}`;
  }
  return appRoutes[input.id].path;
}
