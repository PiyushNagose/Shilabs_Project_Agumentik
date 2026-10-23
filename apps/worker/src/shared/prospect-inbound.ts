import type { Prisma } from "@prisma/client";
import { workerPrisma } from "../domain-events/domain-event.repository.js";

export function isNonMeaningfulInboundMetadata(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== "object") return false;
  const classification = (metadata as Record<string, unknown>).inboundClassification;
  if (!classification || typeof classification !== "object") return false;
  const value = classification as Record<string, unknown>;
  return value.version === 1 && value.kind === "NONMEANINGFUL";
}

export async function hasMeaningfulProspectInboundAfter(
  input: { leadId: string; since: Date },
  db: Pick<Prisma.TransactionClient, "inboundEmail" | "message"> = workerPrisma
): Promise<boolean> {
  const [inbounds, messages] = await Promise.all([
    db.inboundEmail.findMany({
      where: { leadId: input.leadId, status: "PROCESSED", receivedAt: { gte: input.since } },
      select: { message: { select: { metadata: true } } }
    }),
    db.message.findMany({
      where: {
        direction: "INBOUND",
        senderType: "PROSPECT",
        conversation: { leadId: input.leadId },
        OR: [
          { sentAt: { gte: input.since } },
          { deliveredAt: { gte: input.since } },
          { createdAt: { gte: input.since } }
        ]
      },
      select: { metadata: true }
    })
  ]);
  // Missing metadata (including an unlinked legacy inbound) must still stop automation.
  return (
    inbounds.some((inbound) => !isNonMeaningfulInboundMetadata(inbound.message?.metadata)) ||
    messages.some((message) => !isNonMeaningfulInboundMetadata(message.metadata))
  );
}

export { hasMeaningfulProspectInboundAfter as hasProspectInboundAfter };
