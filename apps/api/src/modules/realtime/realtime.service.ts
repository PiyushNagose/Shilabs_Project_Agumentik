import type { IncomingMessage, Server } from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import { getApiConfig } from "@shilabs/shared-config";
import { UserRole } from "@prisma/client";
import { verifyAccessToken } from "../auth/auth.service.js";
import type { AuthenticatedUser } from "../auth/auth.types.js";
import { prisma } from "../../shared/prisma.js";
import { resolveWorkspaceContext } from "../workspaces/workspace.service.js";

export type RealtimeEntityType =
  | "workspace"
  | "lead"
  | "task"
  | "activity"
  | "dashboard"
  | "operations"
  | "notifications"
  | "domain-event";

export interface RealtimeEvent {
  type: "realtime:update";
  entityType: RealtimeEntityType;
  action: string;
  leadId?: string | null;
  conversationId?: string | null;
  domainEventId?: string | null;
  sourceEventType?: string | null;
  taskId?: string | null;
  occurredAt: string;
}

interface RealtimeClient {
  socket: WebSocket;
  user: AuthenticatedUser;
  workspaceId: string;
}

const clients = new Map<WebSocket, RealtimeClient>();

function jsonMessage(event: RealtimeEvent): string {
  return JSON.stringify(event);
}

function canReceiveLeadEvent(user: AuthenticatedUser, ownerId: string | null | undefined): boolean {
  if (user.role === UserRole.ADMIN || user.role === UserRole.SALES_MANAGER) return true;
  return ownerId === null || ownerId === user.id;
}

export async function resolveRealtimeEventScope(input: {
  leadId?: string | null;
  conversationId?: string | null;
  domainEventId?: string | null;
  taskId?: string | null;
}): Promise<{ workspaceId: string; ownerId: string | null } | null> {
  const [lead, conversation, domainEvent, task] = await Promise.all([
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
      : null
  ]);
  const scopes = [
    lead?.workspaceId,
    conversation?.workspaceId ?? conversation?.lead.workspaceId,
    domainEvent?.workspaceId,
    task?.workspaceId,
    task?.lead?.workspaceId
  ].filter((value): value is string => Boolean(value));
  if (scopes.length === 0) return null;
  if (new Set(scopes).size !== 1) return null;
  const workspaceId = scopes[0];
  if (!workspaceId) return null;
  return {
    workspaceId,
    ownerId: lead?.ownerId ?? conversation?.lead.ownerId ?? task?.lead?.ownerId ?? null
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
  const message = jsonMessage(event);
  for (const client of clients.values()) {
    if (client.socket.readyState !== WebSocket.OPEN) continue;
    if (
      !canDeliverRealtimeEvent({
        clientWorkspaceId: client.workspaceId,
        eventWorkspaceId: scope.workspaceId,
        user: client.user,
        ownerId: scope.ownerId,
        hasLeadScope: Boolean(event.leadId ?? event.conversationId ?? event.taskId)
      })
    )
      continue;
    client.socket.send(message);
  }
}

export function installRealtimeWebSocketServer(server: Server): () => Promise<void> {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (request: IncomingMessage, socket, head) => {
    const host = request.headers.host ?? "localhost";
    const url = new URL(request.url ?? "/", `http://${host}`);
    if (url.pathname !== "/realtime") return;

    const token = url.searchParams.get("token");
    if (!token) {
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
        };
        realtimeRequest.realtimeUser = user;
        realtimeRequest.realtimeWorkspaceId = workspace.workspaceId;
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
    };
    const user = realtimeRequest.realtimeUser;
    const workspaceId = realtimeRequest.realtimeWorkspaceId;
    if (!user || !workspaceId) {
      socket.close(1008, "Authentication required");
      return;
    }
    clients.set(socket, { socket, user, workspaceId });
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

  return () =>
    new Promise<void>((resolve) => {
      for (const socket of wss.clients) socket.terminate();
      clients.clear();
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
