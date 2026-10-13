import type { Prisma } from "@prisma/client";
import { prisma } from "../../shared/prisma.js";

export const orderInclude = {
  company: true,
  contact: true,
  owner: true,
  items: { orderBy: [{ createdAt: "asc" as const }, { id: "asc" as const }] },
  deal: {
    include: {
      lead: { include: { company: true, contact: true, owner: true, stage: true } },
      stage: true,
      owner: true
    }
  }
} satisfies Prisma.OrderInclude;

export type OrderRecord = Prisma.OrderGetPayload<{ include: typeof orderInclude }>;

export function findOrder(id: string, workspaceId: string): Promise<OrderRecord | null> {
  return prisma.order.findFirst({ where: { id, workspaceId }, include: orderInclude });
}

export async function listOrderRecords(input: {
  where: Prisma.OrderWhereInput;
  skip: number;
  take: number;
}): Promise<{ orders: OrderRecord[]; total: number }> {
  const [orders, total] = await prisma.$transaction([
    prisma.order.findMany({
      where: input.where,
      include: orderInclude,
      orderBy: [{ orderedAt: "desc" }, { id: "asc" }],
      skip: input.skip,
      take: input.take
    }),
    prisma.order.count({ where: input.where })
  ]);
  return { orders, total };
}
