import type { IncomingMessage, Server } from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import { emitOperationalAlert, getApiConfig } from "@shilabs/shared-config";
import { RealtimeRelay } from "./realtime-relay.js";
import { verifyAccessToken } from "../auth/auth.service.js";
import type { AuthenticatedUser } from "../auth/auth.types.js";
import { prisma } from "../../shared/prisma.js";
import { resolveWorkspaceContext } from "../workspaces/workspace.service.js";
import { isWorkspaceManager } from "../authorization/workspace-permissions.js";

export type RealtimeEntityType =
  | "workspace"
  | "lead"
  | "contact"
  | "company"
  | "conversation"
  | "qualification"
  | "proposal"
  | "meeting"
  | "deal"
  | "pipeline"
  | "task"
  | "activity"
  | "dashboard"
  | "operations"
  | "notifications"
  | "domain-event"
  | "agent"
  | "workflow"
  | "integration"
  | "order";

export interface RealtimeEvent {
  type: "realtime:update";
  entityType: RealtimeEntityType;
  action: string;
  leadId?: string | null;
  conversationId?: string | null;
  domainEventId?: string | null;
  sourceEventType?: string | null;
  taskId?: string | null;
  orderId?: string | null;
  workspaceId?: string | null;
  occurredAt: string;
}

interface RealtimeClient {
  socket: WebSocket;
  user: AuthenticatedUser;
  workspaceId: string;
  accessToken: string;
}

const clients = new Map<WebSocket, RealtimeClient>();
let relay: RealtimeRelay | null = null;
let serverCount = 0;
let lastRelayAlertAt = 0;

function relayError(): void {
  if (Date.now() - lastRelayAlertAt < 60000) return;
  lastRelayAlertAt = Date.now();
  void emitOperationalAlert({
    category: "realtime_relay_failure",
    severity: "error",
    message: "Shared live updates are unavailable; database reads remain available."
  });
}

function jsonMessage(event: RealtimeEvent): string {
  return JSON.stringify(event);
}

function canReceiveLeadEvent(user: AuthenticatedUser, ownerId: string | null | undefined): boolean {
  if (isWorkspaceManager(user)) return true;
  return ownerId === null || ownerId === user.id;
}

export async function resolveRealtimeEventScope(input: {
  leadId?: string | null;
  conversationId?: string | null;
  domainEventId?: string | null;
  taskId?: string | null;
  orderId?: string | null;
  workspaceId?: string | null;
}): Promise<{ workspaceId: string; ownerId: string | null } | null> {
  const [lead, conversation, domainEvent, task, order] = await Promise.all([
    input.leadId
      ? prisma.lead.findUnique({
          where: { id: input.leadId },
          select: { workspaceId: true, ownerId: true }
        })
      : null,
    input.conversationId
      ? prisma.conversation.findUnique({
          where: { id: input.conversationId },
          select: { workspaceId: true, lead: { select: { workspaceId: true, ownerId: true } } }
        })
      : null,
    input.domainEventId
      ? prisma.domainEventOutbox.findUnique({
          where: { id: input.domainEventId },
          select: { workspaceId: true }
        })
      : null,
    input.taskId
      ? prisma.task.findUnique({
          where: { id: input.taskId },
          select: { workspaceId: true, lead: { select: { workspaceId: true, ownerId: true } } }
        })
      : null,
    input.orderId
      ? prisma.order.findUnique({
          where: { id: input.orderId },
          select: {
            workspaceId: true,
            ownerId: true,
            deal: { select: { lead: { select: { workspaceId: true, ownerId: true } } } }
          }
        })
      : null
  ]);
  const scopes = [
    input.workspaceId,
    lead?.workspaceId,
    conversation?.workspaceId ?? conversation?.lead.workspaceId,
    domainEvent?.workspaceId,
    task?.workspaceId,
    task?.lead?.workspaceId,
    order?.workspaceId,
    order?.deal?.lead.workspaceId
  ].filter((value): value is string => Boolean(value));
  if (scopes.length === 0) return null;
  if (new Set(scopes).size !== 1) return null;
  const workspaceId = scopes[0];
  if (!workspaceId) return null;
  return {
    workspaceId,
    ownerId:
      lead?.ownerId ??
      conversation?.lead.ownerId ??
      task?.lead?.ownerId ??
      order?.ownerId ??
      order?.deal?.lead.ownerId ??
      null
  };
}

export function canDeliverRealtimeEvent(input: {
  clientWorkspaceId: string;
  eventWorkspaceId: string;
  user: AuthenticatedUser;
  ownerId: string | null;
  hasLeadScope: boolean;
}): boolean {
  if (input.clientWorkspaceId !== input.eventWorkspaceId) return false;
  return !input.hasLeadScope || canReceiveLeadEvent(input.user, input.ownerId);
}

export async function publishRealtimeEvent(
  input: Omit<RealtimeEvent, "type" | "occurredAt">
): Promise<void> {
  const event: RealtimeEvent = {
    type: "realtime:update",
    occurredAt: new Date().toISOString(),
    ...input
  };
  const scope = await resolveRealtimeEventScope(event);
  if (!scope) return;
  event.workspaceId = scope.workspaceId;
  await deliverRealtimeEvent(event, scope);
  if (relay) await relay.publish(event).catch(relayError);
}

async function deliverRealtimeEvent(
  event: RealtimeEvent,
  resolvedScope?: { workspaceId: string; ownerId: string | null }
): Promise<void> {
  const scope = resolvedScope ?? (await resolveRealtimeEventScope(event));
  if (!scope) return;
  const message = jsonMessage(event);
  for (const client of clients.values()) {
    if (client.socket.readyState !== WebSocket.OPEN) continue;
    if (client.workspaceId !== scope.workspaceId) continue;
    try {
      const user = await verifyAccessToken(client.accessToken);
      const workspace = await resolveWorkspaceContext(user.id, client.workspaceId);
      client.user = {
        ...user,
        activeWorkspaceId: workspace.workspaceId,
        activeWorkspaceRole: workspace.role
      };
    } catch {
      clients.delete(client.socket);
      client.socket.close(1008, "Access no longer available");
      continue;
    }
    if (
      !canDeliverRealtimeEvent({
        clientWorkspaceId: client.workspaceId,
        eventWorkspaceId: scope.workspaceId,
        user: client.user,
        ownerId: scope.ownerId,
        hasLeadScope: Boolean(event.leadId ?? event.conversationId ?? event.taskId ?? event.orderId)
      })
    )
      continue;
    client.socket.send(message);
  }
}

function nonEmptyEnvironmentValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  return trimmed;
}

export function installRealtimeWebSocketServer(server: Server): () => Promise<void> {
  serverCount += 1;
  const configuredRelayUrl = nonEmptyEnvironmentValue(process.env.REALTIME_REDIS_URL);
  const fallbackRelayUrl =
    process.env.NODE_ENV === "test" ? undefined : nonEmptyEnvironmentValue(process.env.REDIS_URL);
  const relayUrl = configuredRelayUrl ?? fallbackRelayUrl;
  const configuredChannel = nonEmptyEnvironmentValue(process.env.REALTIME_REDIS_CHANNEL);
  if (!relay && relayUrl) {
    relay = new RealtimeRelay(
      relayUrl,
      configuredChannel ?? "shilabs:realtime:v1",
      (event) => deliverRealtimeEvent(event as RealtimeEvent),
      relayError
    );
  }
  const protocol = "shilabs.realtime.v1";
  const wss = new WebSocketServer({
    noServer: true,
    // Never echo the credential-bearing subprotocol in the handshake response.
    handleProtocols: (protocols) => (protocols.has(protocol) ? protocol : false)
  });

  server.on("upgrade", (request: IncomingMessage, socket, head) => {
    const host = request.headers.host ?? "localhost";
    const url = new URL(request.url ?? "/", `http://${host}`);
    if (url.pathname !== "/realtime") return;

    const protocols =
      request.headers["sec-websocket-protocol"]?.split(",").map((value) => value.trim()) ?? [];
    const credentials = protocols.filter((value) => value.startsWith("bearer."));
    const token = credentials.length === 1 ? credentials[0]?.slice("bearer.".length) : undefined;
    if (url.searchParams.has("token") || !protocols.includes(protocol) || !token) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }

    void verifyAccessToken(token)
      .then(async (user) => {
        const workspace = await resolveWorkspaceContext(
          user.id,
          url.searchParams.get("workspaceId") ?? undefined
        );
        const realtimeRequest = request as IncomingMessage & {
          realtimeUser?: AuthenticatedUser;
          realtimeWorkspaceId?: string;
          realtimeAccessToken?: string;
        };
        realtimeRequest.realtimeUser = {
          ...user,
          activeWorkspaceId: workspace.workspaceId,
          activeWorkspaceRole: workspace.role
        };
        realtimeRequest.realtimeWorkspaceId = workspace.workspaceId;
        realtimeRequest.realtimeAccessToken = token;
        wss.handleUpgrade(request, socket, head, (ws) => {
          wss.emit("connection", ws, request);
        });
      })
      .catch(() => {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
      });
  });

  wss.on("connection", (socket: WebSocket, request: IncomingMessage) => {
    const realtimeRequest = request as IncomingMessage & {
      realtimeUser?: AuthenticatedUser;
      realtimeWorkspaceId?: string;
      realtimeAccessToken?: string;
    };
    const user = realtimeRequest.realtimeUser;
    const workspaceId = realtimeRequest.realtimeWorkspaceId;
    const accessToken = realtimeRequest.realtimeAccessToken;
    if (!user || !workspaceId || !accessToken) {
      socket.close(1008, "Authentication required");
      return;
    }
    clients.set(socket, { socket, user, workspaceId, accessToken });
    socket.send(
      JSON.stringify({
        type: "realtime:connected",
        userId: user.id,
        workspaceId,
        occurredAt: new Date().toISOString()
      })
    );
    socket.on("close", () => {
      clients.delete(socket);
    });
  });

  let closed = false;
  return () =>
    new Promise<void>((resolve) => {
      if (closed) {
        resolve();
        return;
      }
      closed = true;
      serverCount -= 1;
      if (serverCount === 0) {
        relay?.close();
        relay = null;
      }
      for (const socket of wss.clients) {
        clients.delete(socket);
        socket.terminate();
      }
      wss.close(() => resolve());
    });
}

export function isInternalRealtimePublishAuthorized(secret: string | undefined): boolean {
  const config = getApiConfig();
  if (!config.realtimeInternalSecret) {
    return config.nodeEnv !== "production";
  }
  return secret === config.realtimeInternalSecret;
}
