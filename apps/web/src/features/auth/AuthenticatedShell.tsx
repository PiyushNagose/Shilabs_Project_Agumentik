import type React from "react";
import { appRoutes, navigationByRole, type AppRouteId } from "../../app/routing.js";
import { useAppRouter } from "../../app/useAppRouter.js";
import { AppShell } from "../../components/shell/AppShell.js";
import { SalesActionDashboard } from "../dashboard/SalesActionDashboard.js";
import { CompaniesWorkspace } from "../companies/CompaniesWorkspace.js";
import { LeadContactsWorkspace } from "../contacts/LeadContactsWorkspace.js";
import { DealsWorkspace } from "../deals/DealsWorkspace.js";
import { CrmWorkspace, type DetailTab } from "../leads/CrmWorkspace.js";
import { OperationsDashboard } from "../operations/OperationsDashboard.js";
import { AgentsWorkspace } from "../agents/AgentsWorkspace.js";
import { useAuth } from "./AuthProvider.js";

export function AuthenticatedShell(): React.JSX.Element {
  const { accessToken, user, logout } = useAuth();
  const role = user?.role ?? "SALES_REP";
  const allowedRoutes = navigationByRole[role];
  const { route, navigate } = useAppRouter(allowedRoutes);

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
          onRouteChange={(agentId) => navigate({ id: "agents", leadId: null, agentId })}
        />
      </section>
    );
  } else if (route.id === "crm" || route.id === "workspace") {
    content = (
      <CrmWorkspace
        accessToken={accessToken}
        currentUser={user}
        initialLeadId={route.leadId}
        initialTab={route.tab}
        onRouteChange={openWorkspace}
      />
    );
  } else {
    content = (
      <section className="crm-workspace">
        <div className="workspace-panel reserved-workspace">
          <div className="state-block" role="status">
            <strong>{appRoutes[route.id].label} is not available yet</strong>
            <span>This section has not been enabled.</span>
          </div>
        </div>
      </section>
    );
  }

  return (
    <AppShell
      activeRoute={route.id}
      allowedRoutes={allowedRoutes}
      user={user}
      onLogout={() => void logout()}
      onNavigate={navigateTo}
    >
      <section className="access-summary" aria-labelledby="access-title">
        <h1 id="access-title">{appRoutes[route.id].title}</h1>
        <p>{user.role.replace("_", " ")} permissions are active for this account.</p>
      </section>
      {content}
    </AppShell>
  );
}
