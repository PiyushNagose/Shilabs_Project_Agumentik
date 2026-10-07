import { Router } from "express";
import { asyncHandler } from "../../middleware/async-handler.js";
import { requireAuth } from "../../middleware/auth.middleware.js";
import { requireWorkspaceContext } from "../../middleware/workspace.middleware.js";
import { prisma } from "../../shared/prisma.js";

export const workspaceRoutes = Router();
workspaceRoutes.use(requireAuth, requireWorkspaceContext);
workspaceRoutes.get("/", asyncHandler(async (request, response) => {
  const user = request.user;
  if (!user) throw new Error("Authenticated user context is missing");
  const memberships = await prisma.workspaceMember.findMany({
    where: { userId: user.id, status: "ACTIVE" },
    include: { workspace: true },
    orderBy: { joinedAt: "asc" }
  });
  response.json({
    activeWorkspaceId: request.workspace?.workspaceId,
    items: memberships.map((member) => ({
      id: member.workspace.id,
      name: member.workspace.name,
      slug: member.workspace.slug,
      role: member.role,
      status: member.status
    }))
  });
}));
