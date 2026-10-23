import { UserRole, UserStatus, WorkspaceRole } from "@prisma/client";
import { describe, expect, it } from "vitest";
import type { AuthenticatedUser } from "../auth/auth.types.js";
import {
  canAccessWorkspaceOperations,
  isWorkspaceAdmin,
  isWorkspaceManager,
  workspaceRoleMatchesLegacyRoles
} from "./workspace-permissions.js";

function actor(globalRole: UserRole, workspaceRole?: WorkspaceRole): AuthenticatedUser {
  return {
    id: "user-1",
    email: "user@example.local",
    firstName: "Workspace",
    lastName: "Member",
    role: globalRole,
    status: UserStatus.ACTIVE,
    createdAt: new Date("2026-10-01T00:00:00.000Z"),
    updatedAt: new Date("2026-10-01T00:00:00.000Z"),
    activeWorkspaceId: "workspace-1",
    ...(workspaceRole ? { activeWorkspaceRole: workspaceRole } : {})
  };
}

describe("workspace permissions", () => {
  it("does not carry a global administrator role into a viewer membership", () => {
    const viewer = actor(UserRole.ADMIN, WorkspaceRole.VIEWER);

    expect(isWorkspaceAdmin(viewer)).toBe(false);
    expect(isWorkspaceManager(viewer)).toBe(false);
    expect(workspaceRoleMatchesLegacyRoles(viewer, [UserRole.ADMIN])).toBe(false);
  });

  it("treats a workspace owner as an administrator regardless of the legacy role", () => {
    const owner = actor(UserRole.SALES_REP, WorkspaceRole.OWNER);

    expect(isWorkspaceAdmin(owner)).toBe(true);
    expect(isWorkspaceManager(owner)).toBe(true);
    expect(workspaceRoleMatchesLegacyRoles(owner, [UserRole.ADMIN])).toBe(true);
  });

  it("keeps operations and viewers out of legacy sales role gates", () => {
    expect(
      workspaceRoleMatchesLegacyRoles(actor(UserRole.SALES_REP, WorkspaceRole.OPERATIONS), [
        UserRole.SALES_REP
      ])
    ).toBe(false);
    expect(
      workspaceRoleMatchesLegacyRoles(actor(UserRole.SALES_REP, WorkspaceRole.VIEWER), [
        UserRole.SALES_REP
      ])
    ).toBe(false);
  });

  it("allows the operations workspace role into operational tooling but rejects viewers", () => {
    expect(canAccessWorkspaceOperations(actor(UserRole.SALES_REP, WorkspaceRole.OPERATIONS))).toBe(
      true
    );
    expect(canAccessWorkspaceOperations(actor(UserRole.ADMIN, WorkspaceRole.VIEWER))).toBe(false);
  });

  it("supports legacy test actors that do not yet provide a workspace role", () => {
    expect(isWorkspaceManager(actor(UserRole.SALES_MANAGER))).toBe(true);
    expect(workspaceRoleMatchesLegacyRoles(actor(UserRole.SALES_REP), [UserRole.SALES_REP])).toBe(
      true
    );
  });
});
