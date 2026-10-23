import type { UserRoleName } from "@shilabs/shared-types";
import type { LucideIcon } from "lucide-react";
import {
  BarChart3,
  Bot,
  BrainCircuit,
  BriefcaseBusiness,
  Building2,
  ContactRound,
  Handshake,
  LayoutDashboard,
  Settings,
  Plug,
  ShoppingBag,
  Workflow,
  Users
} from "lucide-react";
import type { DetailTab } from "../features/leads/CrmWorkspace.js";

export type AppRouteId =
  | "dashboard"
  | "crm"
  | "deals"
  | "contacts"
  | "companies"
  | "agents"
  | "workflows"
  | "integrations"
  | "command-center"
  | "orders"
  | "operations"
  | "users"
  | "settings"
  | "team"
  | "reports"
  | "workspace";

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
  orderId?: string | null;
  agentId?: string | null;
  agentTab?: AgentDetailTab;
  workflowId?: string | null;
  workflowTab?: WorkflowDetailTab;
  tab?: DetailTab;
}

export type AgentDetailTab = "composer" | "executions" | "evaluation" | "versions" | "overview";
export type WorkflowDetailTab = "builder" | "executions" | "versions" | "overview";

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
  agents: {
    id: "agents",
    label: "Agents",
    title: "AI Agents",
    path: "/agents",
    icon: Bot
  },
  workflows: {
    id: "workflows",
    label: "Workflows",
    title: "Workflow Automation",
    path: "/workflows",
    icon: Workflow
  },
  integrations: {
    id: "integrations",
    label: "Integrations",
    title: "Integrations",
    path: "/integrations",
    icon: Plug
  },
  "command-center": {
    id: "command-center",
    label: "AI Command",
    title: "AI Command Center",
    path: "/ai-command-center",
    icon: BrainCircuit
  },
  orders: {
    id: "orders",
    label: "Orders",
    title: "Order Queue",
    path: "/orders",
    icon: ShoppingBag
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
  ADMIN: [
    "dashboard",
    "crm",
    "deals",
    "contacts",
    "companies",
    "agents",
    "workflows",
    "integrations",
    "command-center",
    "orders",
    "operations",
    "users",
    "reports",
    "settings"
  ],
  SALES_MANAGER: [
    "dashboard",
    "crm",
    "deals",
    "contacts",
    "companies",
    "agents",
    "workflows",
    "integrations",
    "command-center",
    "orders",
    "operations",
    "team",
    "reports",
    "settings"
  ],
  SALES_REP: [
    "dashboard",
    "crm",
    "deals",
    "contacts",
    "companies",
    "agents",
    "workflows",
    "orders",
    "workspace"
  ]
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

function isAgentDetailTab(value: string | null): value is AgentDetailTab {
  return (
    value === "composer" ||
    value === "executions" ||
    value === "evaluation" ||
    value === "versions" ||
    value === "overview"
  );
}
function isWorkflowDetailTab(value: string | null): value is WorkflowDetailTab {
  return (
    value === "builder" || value === "executions" || value === "versions" || value === "overview"
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
  if (path.startsWith("/orders/") && canOpen("orders")) {
    return {
      id: "orders",
      leadId: null,
      orderId: decodeURIComponent(path.slice("/orders/".length))
    };
  }

  if (path.startsWith("/agents/") && canOpen("agents")) {
    const agentTab = new URLSearchParams(window.location.search).get("tab");
    return {
      id: "agents",
      leadId: null,
      agentId: decodeURIComponent(path.slice("/agents/".length)),
      agentTab: isAgentDetailTab(agentTab) ? agentTab : undefined
    };
  }
  if (path.startsWith("/workflows/") && canOpen("workflows")) {
    const workflowTab = new URLSearchParams(window.location.search).get("tab");
    return {
      id: "workflows",
      leadId: null,
      workflowId: decodeURIComponent(path.slice("/workflows/".length)),
      workflowTab: isWorkflowDetailTab(workflowTab) ? workflowTab : undefined
    };
  }

  const route = Object.values(appRoutes).find(
    (candidate) => candidate.path === path && canOpen(candidate.id)
  );
  return { id: route?.id ?? firstAllowedRoute, leadId: null };
}

export function appPath(input: AppRouteState): string {
  if (input.id === "workflows" && input.workflowId) {
    const params = new URLSearchParams();
    if (input.workflowTab) params.set("tab", input.workflowTab);
    const query = params.toString();
    return `/workflows/${encodeURIComponent(input.workflowId)}${query ? `?${query}` : ""}`;
  }
  if (input.id === "agents" && input.agentId) {
    const params = new URLSearchParams();
    if (input.agentTab) params.set("tab", input.agentTab);
    const query = params.toString();
    return `/agents/${encodeURIComponent(input.agentId)}${query ? `?${query}` : ""}`;
  }
  if (input.id === "deals" && input.dealId) return `/deals/${encodeURIComponent(input.dealId)}`;
  if (input.id === "orders" && input.orderId) return `/orders/${encodeURIComponent(input.orderId)}`;
  if ((input.id === "crm" || input.id === "workspace") && input.leadId) {
    const params = new URLSearchParams();
    if (input.tab) params.set("tab", input.tab);
    const query = params.toString();
    return `/crm/leads/${encodeURIComponent(input.leadId)}${query ? `?${query}` : ""}`;
  }
  return appRoutes[input.id].path;
}
