import type { IncomingMessage, Server } from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import { getApiConfig } from "@shilabs/shared-config";
import { UserRole } from "@prisma/client";
import { verifyAccessToken } from "../auth/auth.service.js";
import type { AuthenticatedUser } from "../auth/auth.types.js";
import { prisma } from "../../shared/prisma.js";

export type RealtimeEntityType =
  | "workspace"
  | "lead"
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
  occurredAt: string;
}

interface RealtimeClient {
  socket: WebSocket;
  user: AuthenticatedUser;
}

const clients = new Map<WebSocket, RealtimeClient>();

function jsonMessage(event: RealtimeEvent): string {
  return JSON.stringify(event);
}

function canReceiveLeadEvent(user: AuthenticatedUser, ownerId: string | null | undefined): boolean {
  if (user.role === UserRole.ADMIN || user.role === UserRole.SALES_MANAGER) return true;
  return Boolean(ownerId && ownerId === user.id);
}

async function ownerIdForLead(leadId: string | null | undefined): Promise<string | null> {
  if (!leadId) return null;
  const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { ownerId: true } });
  return lead?.ownerId ?? null;
}

export async function publishRealtimeEvent(input: Omit<RealtimeEvent, "type" | "occurredAt">): Promise<void> {
  const event: RealtimeEvent = {
    type: "realtime:update",
    occurredAt: new Date().toISOString(),
    ...input
  };
  const ownerId = await ownerIdForLead(event.leadId);
  const message = jsonMessage(event);
  for (const client of clients.values()) {
    if (client.socket.readyState !== WebSocket.OPEN) continue;
    if (event.leadId && !canReceiveLeadEvent(client.user, ownerId)) continue;
    client.socket.send(message);
  }
}

export function installRealtimeWebSocketServer(server: Server): void {
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
      .then((user) => {
        (request as IncomingMessage & { realtimeUser?: AuthenticatedUser }).realtimeUser = user;
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
    const user = (request as IncomingMessage & { realtimeUser?: AuthenticatedUser }).realtimeUser;
    if (!user) {
      socket.close(1008, "Authentication required");
      return;
    }
    clients.set(socket, { socket, user });
    socket.send(
      JSON.stringify({
        type: "realtime:connected",
        userId: user.id,
        occurredAt: new Date().toISOString()
      })
    );
    socket.on("close", () => {
      clients.delete(socket);
    });
  });
}

export function isInternalRealtimePublishAuthorized(secret: string | undefined): boolean {
  const config = getApiConfig();
  if (!config.realtimeInternalSecret) {
    return config.nodeEnv !== "production";
  }
  return secret === config.realtimeInternalSecret;
}

