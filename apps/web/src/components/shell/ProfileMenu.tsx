import type React from "react";
import { useEffect, useRef, useState } from "react";
import type { PublicUser } from "@shilabs/shared-types";
import { ChevronDown, LogOut, Settings, Users } from "lucide-react";
import type { AppRouteId } from "../../app/routing.js";
import { appPath } from "../../app/routing.js";

function initials(user: PublicUser): string {
  return `${user.firstName.charAt(0)}${user.lastName.charAt(0)}`.toUpperCase();
}

export function ProfileMenu({
  user,
  collapsed,
  allowedRoutes,
  onNavigate,
  onLogout
}: {
  user: PublicUser;
  collapsed: boolean;
  allowedRoutes: readonly AppRouteId[];
  onNavigate: (routeId: AppRouteId) => void;
  onLogout: () => void;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    const handlePointerDown = (event: MouseEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const fullName = `${user.firstName} ${user.lastName}`;
  return (
    <div className="profile-menu-root" ref={rootRef}>
      {open ? (
        <div aria-label="Account menu" className="profile-popup" role="menu">
          <div className="profile-popup-identity">
            <span className="profile-avatar" aria-hidden="true">
              {initials(user)}
            </span>
            <span>
              <strong>{fullName}</strong>
              <small>{user.email}</small>
            </span>
          </div>
          <div className="profile-popup-role">{user.role.replace("_", " ")}</div>
          <div className="profile-popup-divider" />
          {allowedRoutes.includes("users") ? (
            <a
              href={appPath({ id: "users", leadId: null })}
              role="menuitem"
              onClick={(event) => {
                event.preventDefault();
                setOpen(false);
                onNavigate("users");
              }}
            >
              <Users size={16} />
              Users &amp; access
            </a>
          ) : null}
          {allowedRoutes.includes("settings") ? (
            <a
              href={appPath({ id: "settings", leadId: null })}
              role="menuitem"
              onClick={(event) => {
                event.preventDefault();
                setOpen(false);
                onNavigate("settings");
              }}
            >
              <Settings size={16} />
              Settings
            </a>
          ) : null}
          <button
            className="profile-popup-logout"
            role="menuitem"
            type="button"
            onClick={() => {
              setOpen(false);
              onLogout();
            }}
          >
            <LogOut size={16} />
            Logout
          </button>
        </div>
      ) : null}
      <button
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={collapsed ? `Open account menu for ${fullName}` : "Open account menu"}
        className="profile-trigger"
        title={collapsed ? fullName : undefined}
        type="button"
        onClick={() => setOpen((current) => !current)}
      >
        <span className="profile-avatar" aria-hidden="true">
          {initials(user)}
        </span>
        <span className="profile-trigger-copy">
          <strong>{fullName}</strong>
          <small>{user.email}</small>
        </span>
        <ChevronDown className="profile-chevron" size={15} />
      </button>
    </div>
  );
}
