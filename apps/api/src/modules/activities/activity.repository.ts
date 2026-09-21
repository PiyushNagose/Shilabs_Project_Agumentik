import type { Prisma } from "@prisma/client";
import { prisma } from "../../shared/prisma.js";

const activityInclude = {
  actorUser: true
} satisfies Prisma.ActivityInclude;

export type ActivityRecord = Prisma.ActivityGetPayload<{ include: typeof activityInclude }>;

export async function listLeadActivities(leadId: string): Promise<ActivityRecord[]> {
  return prisma.activity.findMany({
    where: { leadId },
    include: activityInclude,
    orderBy: { createdAt: "desc" }
  });
}
