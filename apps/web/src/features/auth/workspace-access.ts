import type { PublicUser, UserRoleName } from "@shilabs/shared-types";

export function workspaceRole(user: PublicUser): NonNullable<PublicUser["workspaceRole"]> {
  return user.workspaceRole ?? user.role;
}

export function isWorkspaceAdmin(user: PublicUser): boolean {
  return ["OWNER", "ADMIN"].includes(workspaceRole(user));
}

export function isWorkspaceManager(user: PublicUser): boolean {
  return ["OWNER", "ADMIN", "SALES_MANAGER"].includes(workspaceRole(user));
}

export function navigationRole(user: PublicUser): UserRoleName {
  const role = workspaceRole(user);
  if (role === "OWNER" || role === "ADMIN") return "ADMIN";
  if (role === "SALES_MANAGER" || role === "OPERATIONS") return "SALES_MANAGER";
  return "SALES_REP";
}
