import type React from "react";
import type { PublicUser } from "@shilabs/shared-types";
import { PanelLeftClose, PanelLeftOpen, Sparkles, X } from "lucide-react";
import type { AppRouteId } from "../../app/routing.js";
import { appPath, appRoutes } from "../../app/routing.js";
import { ProfileMenu } from "./ProfileMenu.js";

export function Sidebar({
  activeRoute,
  allowedRoutes,
  collapsed,
  mobileOpen,
  user,
  onCollapse,
  onCloseMobile,
  onNavigate,
  onLogout
}: {
  activeRoute: AppRouteId;
  allowedRoutes: readonly AppRouteId[];
  collapsed: boolean;
  mobileOpen: boolean;
  user: PublicUser;
  onCollapse: () => void;
  onCloseMobile: () => void;
  onNavigate: (routeId: AppRouteId) => void;
  onLogout: () => void;
}): React.JSX.Element {
  return (
    <>
      <aside
        className={`app-sidebar${mobileOpen ? " mobile-open" : ""}`}
        aria-label="Application navigation"
      >
        <div className="sidebar-brand">
          <span className="sidebar-brand-mark" aria-hidden="true">
            <Sparkles size={20} />
          </span>
          <span className="sidebar-brand-copy">
            <small>Shilabs Platform</small>
            <strong>AI Sales Engine</strong>
          </span>
          <button
            className="sidebar-mobile-close"
            aria-label="Close navigation"
            type="button"
            onClick={onCloseMobile}
          >
            <X size={18} />
          </button>
        </div>
        <nav className="app-sidebar-nav" aria-label="Primary">
          {allowedRoutes.map((routeId) => {
            const route = appRoutes[routeId];
            const RouteIcon = route.icon;
            const active = activeRoute === routeId;
            return (
              <a
                aria-current={active ? "page" : undefined}
                aria-label={collapsed ? route.label : undefined}
                className={active ? "active-nav" : ""}
                href={appPath({ id: routeId, leadId: null })}
                key={routeId}
                title={collapsed ? route.label : undefined}
                onClick={(event) => {
                  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                  event.preventDefault();
                  onCloseMobile();
                  onNavigate(routeId);
                }}
              >
                <RouteIcon size={18} strokeWidth={1.8} />
                <span>{route.label}</span>
              </a>
            );
          })}
        </nav>
        <div className="sidebar-footer">
          <ProfileMenu
            allowedRoutes={allowedRoutes}
            collapsed={collapsed}
            user={user}
            onLogout={onLogout}
            onNavigate={onNavigate}
          />
          <button
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className="sidebar-collapse"
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            type="button"
            onClick={onCollapse}
          >
            {collapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
            <span>Collapse</span>
          </button>
        </div>
      </aside>
      {mobileOpen ? (
        <button
          className="sidebar-backdrop"
          aria-label="Close navigation"
          type="button"
          onClick={onCloseMobile}
        />
      ) : null}
    </>
  );
}
