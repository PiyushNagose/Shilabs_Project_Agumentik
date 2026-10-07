import type { Prisma } from "@prisma/client";
import { prisma } from "../../shared/prisma.js";

const activityInclude = {
  actorUser: true
} satisfies Prisma.ActivityInclude;

export type ActivityRecord = Prisma.ActivityGetPayload<{ include: typeof activityInclude }>;

export async function listLeadActivities(input: {
  leadId: string;
  workspaceId: string;
}): Promise<ActivityRecord[]> {
  return prisma.activity.findMany({
    where: { leadId: input.leadId, workspaceId: input.workspaceId, visibility: "BUSINESS" },
    include: activityInclude,
    orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }]
  });
}
