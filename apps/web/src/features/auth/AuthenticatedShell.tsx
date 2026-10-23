import type React from "react";
import { useEffect } from "react";
import {
  appRoutes,
  navigationByRole,
  type AgentDetailTab,
  type WorkflowDetailTab,
  type AppRouteId
} from "../../app/routing.js";
import { useAppRouter } from "../../app/useAppRouter.js";
import { AppShell } from "../../components/shell/AppShell.js";
import { SalesActionDashboard } from "../dashboard/SalesActionDashboard.js";
import { CompaniesWorkspace } from "../companies/CompaniesWorkspace.js";
import { LeadContactsWorkspace } from "../contacts/LeadContactsWorkspace.js";
import { DealsWorkspace } from "../deals/DealsWorkspace.js";
import { CrmWorkspace, type DetailTab } from "../leads/CrmWorkspace.js";
import { OperationsDashboard } from "../operations/OperationsDashboard.js";
import { AgentsWorkspace } from "../agents/AgentsWorkspace.js";
import { WorkflowsWorkspace } from "../workflows/WorkflowsWorkspace.js";
import { IntegrationsWorkspace } from "../integrations/IntegrationsWorkspace.js";
import { AiCommandCenter } from "../intelligence/AiCommandCenter.js";
import { OrdersWorkspace } from "../orders/OrdersWorkspace.js";
import { UsersWorkspace } from "../users/UsersWorkspace.js";
import { SettingsWorkspace } from "../settings/SettingsWorkspace.js";
import { ReportsWorkspace } from "../analytics/ReportsWorkspace.js";
import { useAuth } from "./AuthProvider.js";
import { isWorkspaceManager, navigationRole, workspaceRole } from "./workspace-access.js";

const routesWithWorkspaceHeaders = new Set<AppRouteId>([
  "dashboard",
  "operations",
  "contacts",
  "companies",
  "deals",
  "agents",
  "workflows",
  "integrations",
  "command-center",
  "orders",
  "crm",
  "workspace",
  "users",
  "settings",
  "team",
  "reports"
]);

export function AuthenticatedShell(): React.JSX.Element {
  const { accessToken, user, logout, updateCurrentUser } = useAuth();
  const role = user ? navigationRole(user) : "SALES_REP";
  const allowedRoutes = navigationByRole[role];
  const { route, navigate } = useAppRouter(allowedRoutes);

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, [route.id]);

  if (!user || !accessToken) {
    throw new Error("AuthenticatedShell requires a logged-in user");
  }

  const navigateTo = (id: AppRouteId): void => navigate({ id, leadId: null, dealId: null });

  const openWorkspace = (leadId: string | null, tab?: DetailTab): void => {
    navigate({ id: "crm", leadId, tab });
  };

  let content: React.ReactNode;
  if (route.id === "dashboard") {
    content = (
      <SalesActionDashboard
        accessToken={accessToken}
        canEscalate={isWorkspaceManager(user)}
        onOpenLead={openWorkspace}
        onOpenOperations={() => navigateTo("operations")}
      />
    );
  } else if (route.id === "operations") {
    content = <OperationsDashboard accessToken={accessToken} />;
  } else if (route.id === "contacts") {
    content = (
      <section className="app-page-content">
        <LeadContactsWorkspace accessToken={accessToken} onOpenLead={openWorkspace} />
      </section>
    );
  } else if (route.id === "companies") {
    content = (
      <section className="app-page-content">
        <CompaniesWorkspace accessToken={accessToken} onOpenLead={openWorkspace} />
      </section>
    );
  } else if (route.id === "deals") {
    content = (
      <section className="app-page-content">
        <DealsWorkspace
          accessToken={accessToken}
          currentUser={user}
          initialDealId={route.dealId ?? null}
          onRouteChange={(dealId) => navigate({ id: "deals", leadId: null, dealId })}
          onOpenLead={openWorkspace}
        />
      </section>
    );
  } else if (route.id === "agents") {
    content = (
      <section className="app-page-content">
        <AgentsWorkspace
          accessToken={accessToken}
          currentUser={user}
          initialAgentId={route.agentId ?? null}
          initialTab={route.agentTab}
          onRouteChange={(agentId, agentTab?: AgentDetailTab) =>
            navigate({ id: "agents", leadId: null, agentId, agentTab })
          }
        />
      </section>
    );
  } else if (route.id === "workflows") {
    content = (
      <section className="app-page-content">
        <WorkflowsWorkspace
          accessToken={accessToken}
          currentUser={user}
          initialWorkflowId={route.workflowId ?? null}
          initialTab={route.workflowTab}
          onRouteChange={(workflowId, workflowTab?: WorkflowDetailTab) =>
            navigate({ id: "workflows", leadId: null, workflowId, workflowTab })
          }
        />
      </section>
    );
  } else if (route.id === "integrations") {
    content = (
      <section className="app-page-content">
        <IntegrationsWorkspace accessToken={accessToken} />
      </section>
    );
  } else if (route.id === "command-center") {
    content = (
      <section className="app-page-content">
        <AiCommandCenter
          accessToken={accessToken}
          onOpenLead={(leadId) => openWorkspace(leadId, "AI Insights")}
        />
      </section>
    );
  } else if (route.id === "orders") {
    content = (
      <section className="app-page-content">
        <OrdersWorkspace
          accessToken={accessToken}
          initialOrderId={route.orderId ?? null}
          onRouteChange={(orderId) => navigate({ id: "orders", leadId: null, orderId })}
        />
      </section>
    );
  } else if (route.id === "users" || route.id === "team") {
    content = (
      <section className="app-page-content">
        <UsersWorkspace accessToken={accessToken} currentUser={user} />
      </section>
    );
  } else if (route.id === "reports") {
    content = (
      <section className="app-page-content">
        <ReportsWorkspace accessToken={accessToken} />
      </section>
    );
  } else if (route.id === "settings") {
    content = (
      <section className="app-page-content">
        <SettingsWorkspace
          accessToken={accessToken}
          currentUser={user}
          onUserUpdated={updateCurrentUser}
        />
      </section>
    );
  } else {
    content = (
      <CrmWorkspace
        accessToken={accessToken}
        currentUser={user}
        initialLeadId={route.leadId}
        initialTab={route.tab}
        onRouteChange={openWorkspace}
      />
    );
  }

  return (
    <AppShell
      activeRoute={route.id}
      navigationKey={JSON.stringify(route)}
      allowedRoutes={allowedRoutes}
      user={user}
      onLogout={() => void logout()}
      onNavigate={navigateTo}
    >
      {!routesWithWorkspaceHeaders.has(route.id) ? (
        <section className="access-summary" aria-labelledby="access-title">
          <h1 id="access-title">{appRoutes[route.id].title}</h1>
          <p>{workspaceRole(user).replaceAll("_", " ")} permissions are active here.</p>
        </section>
      ) : null}
      {content}
    </AppShell>
  );
}
