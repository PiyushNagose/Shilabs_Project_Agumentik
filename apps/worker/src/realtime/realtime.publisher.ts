import type { DomainEventOutbox, Prisma } from "@prisma/client";
import { getWorkerConfig } from "@shilabs/shared-config";

type RealtimeEntityType = "workspace" | "lead" | "dashboard" | "operations" | "notifications" | "domain-event";

function payloadString(event: DomainEventOutbox, key: string): string | null {
  const payload = event.payload as Prisma.JsonObject;
  const value = payload[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export async function publishWorkerRealtimeEvent(input: {
  event: DomainEventOutbox;
  action: string;
  entityType?: RealtimeEntityType;
  env?: NodeJS.ProcessEnv;
}): Promise<void> {
  const config = getWorkerConfig(input.env);
  const endpoint = `${config.apiBaseUrl.replace(/\/$/u, "")}/api/realtime/internal/events`;
  const leadId = payloadString(input.event, "leadId");
  const conversationId = payloadString(input.event, "conversationId");

  await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(config.realtimeInternalSecret
        ? { "x-shilabs-realtime-secret": config.realtimeInternalSecret }
        : {})
    },
    body: JSON.stringify({
      entityType: input.entityType ?? (leadId ? "lead" : "operations"),
      action: input.action,
      leadId,
      conversationId,
      domainEventId: input.event.id,
      sourceEventType: input.event.eventType
    })
  }).catch(() => undefined);
}

