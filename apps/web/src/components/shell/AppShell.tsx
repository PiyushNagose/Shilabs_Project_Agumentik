import type React from "react";
import { useState } from "react";
import type { PublicUser } from "@shilabs/shared-types";
import { Menu, Sparkles } from "lucide-react";
import type { AppRouteId } from "../../app/routing.js";
import { Sidebar } from "./Sidebar.js";

const SIDEBAR_STORAGE_KEY = "shilabs.sidebar.collapsed";

export function AppShell({
  activeRoute,
  allowedRoutes,
  user,
  onNavigate,
  onLogout,
  children
}: {
  activeRoute: AppRouteId;
  allowedRoutes: readonly AppRouteId[];
  user: PublicUser;
  onNavigate: (routeId: AppRouteId) => void;
  onLogout: () => void;
  children: React.ReactNode;
}): React.JSX.Element {
  const [collapsed, setCollapsed] = useState(
    () => window.localStorage.getItem(SIDEBAR_STORAGE_KEY) === "true"
  );
  const [mobileOpen, setMobileOpen] = useState(false);

  const toggleCollapsed = (): void => {
    setCollapsed((current) => {
      window.localStorage.setItem(SIDEBAR_STORAGE_KEY, String(!current));
      return !current;
    });
  };

  return (
    <main className={`authenticated-shell app-shell${collapsed ? " sidebar-collapsed" : ""}`}>
      <Sidebar
        activeRoute={activeRoute}
        allowedRoutes={allowedRoutes}
        collapsed={collapsed}
        mobileOpen={mobileOpen}
        user={user}
        onCloseMobile={() => setMobileOpen(false)}
        onCollapse={toggleCollapsed}
        onLogout={onLogout}
        onNavigate={onNavigate}
      />
      <div className="app-shell-main">
        <header className="app-mobile-header">
          <button aria-label="Open navigation" type="button" onClick={() => setMobileOpen(true)}>
            <Menu size={19} />
          </button>
          <span>
            <Sparkles size={17} /> AI Sales Engine
          </span>
        </header>
        <div className="app-shell-content">{children}</div>
      </div>
    </main>
  );
}
