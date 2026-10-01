import type React from "react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { apiBaseUrl } from "../../services/api-client.js";
import { useAuth } from "../auth/AuthProvider.js";

export type RealtimeEntityType =
  | "workspace"
  | "lead"
  | "dashboard"
  | "operations"
  | "notifications"
  | "domain-event";

export interface RealtimeUpdateEvent {
  type: "realtime:update" | "realtime:reconnected";
  entityType: RealtimeEntityType;
  action: string;
  leadId?: string | null;
  conversationId?: string | null;
  domainEventId?: string | null;
  sourceEventType?: string | null;
  occurredAt: string;
}

type RealtimeListener = (event: RealtimeUpdateEvent) => void;

interface RealtimeContextValue {
  status: "connecting" | "connected" | "disconnected";
  subscribe: (listener: RealtimeListener) => () => void;
}

const RealtimeContext = createContext<RealtimeContextValue | null>(null);

function realtimeUrl(accessToken: string): string {
  const url = new URL(apiBaseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/realtime";
  url.search = "";
  url.searchParams.set("token", accessToken);
  return url.toString();
}

function isRealtimeUpdate(value: unknown): value is RealtimeUpdateEvent {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { type?: unknown }).type === "realtime:update"
  );
}

export function RealtimeProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const { accessToken, status: authStatus } = useAuth();
  const [status, setStatus] = useState<RealtimeContextValue["status"]>("disconnected");
  const listeners = useRef(new Set<RealtimeListener>());
  const reconnectTimer = useRef<number | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const connectedOnce = useRef(false);

  const emit = useCallback((event: RealtimeUpdateEvent): void => {
    for (const listener of listeners.current) {
      listener(event);
    }
  }, []);

  useEffect(() => {
    if (authStatus !== "authenticated" || !accessToken) {
      socketRef.current?.close();
      socketRef.current = null;
      setStatus("disconnected");
      return undefined;
    }

    let disposed = false;
    let reconnectAttempt = 0;

    const clearReconnect = (): void => {
      if (reconnectTimer.current !== null) {
        window.clearTimeout(reconnectTimer.current);
        reconnectTimer.current = null;
      }
    };

    const connect = (): void => {
      clearReconnect();
      if (disposed) return;
      setStatus("connecting");
      const socket = new WebSocket(realtimeUrl(accessToken));
      socketRef.current = socket;
      socket.onopen = () => {
        reconnectAttempt = 0;
        setStatus("connected");
        if (connectedOnce.current) {
          emit({
            type: "realtime:reconnected",
            entityType: "workspace",
            action: "reconnected",
            occurredAt: new Date().toISOString()
          });
        }
        connectedOnce.current = true;
      };
      socket.onmessage = (message) => {
        try {
          const parsed: unknown = JSON.parse(String(message.data));
          if (isRealtimeUpdate(parsed)) {
            emit(parsed);
          }
        } catch {
          // Ignore malformed realtime frames; HTTP refetches remain the source of truth.
        }
      };
      socket.onclose = () => {
        if (socketRef.current === socket) socketRef.current = null;
        if (disposed) return;
        setStatus("disconnected");
        const delay = Math.min(1000 * 2 ** reconnectAttempt, 15000);
        reconnectAttempt += 1;
        reconnectTimer.current = window.setTimeout(connect, delay);
      };
      socket.onerror = () => {
        socket.close();
      };
    };

    connect();
    return () => {
      disposed = true;
      clearReconnect();
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, [accessToken, authStatus, emit]);

  const subscribe = useCallback((listener: RealtimeListener) => {
    listeners.current.add(listener);
    return () => {
      listeners.current.delete(listener);
    };
  }, []);

  const value = useMemo<RealtimeContextValue>(() => ({ status, subscribe }), [status, subscribe]);
  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>;
}

export function useRealtime(): RealtimeContextValue {
  const value = useContext(RealtimeContext);
  if (!value) {
    throw new Error("useRealtime must be used inside RealtimeProvider");
  }
  return value;
}

