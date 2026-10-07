/**
 * @vitest-environment happy-dom
 */
import React from "react";
import { act, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "../auth/AuthProvider.js";
import { RealtimeProvider, useRealtime, type RealtimeUpdateEvent } from "./RealtimeProvider.js";

const user = {
  id: "user_realtime",
  email: "realtime@example.local",
  firstName: "Realtime",
  lastName: "User",
  role: "ADMIN",
  status: "ACTIVE",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
};

class MockWebSocket {
  public static instances: MockWebSocket[] = [];
  public onopen: (() => void) | null = null;
  public onmessage: ((message: { data: string }) => void) | null = null;
  public onclose: (() => void) | null = null;
  public onerror: (() => void) | null = null;
  public readonly url: string;

  public constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  public close(): void {
    this.onclose?.();
  }

  public emitOpen(): void {
    this.onopen?.();
  }

  public emitMessage(event: RealtimeUpdateEvent): void {
    this.onmessage?.({ data: JSON.stringify(event) });
  }
}

function Subscriber({ onEvent }: { onEvent: (event: RealtimeUpdateEvent) => void }): React.JSX.Element {
  const realtime = useRealtime();
  React.useEffect(() => realtime.subscribe(onEvent), [onEvent, realtime]);
  return <span>{realtime.status}</span>;
}

describe("RealtimeProvider", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
    MockWebSocket.instances = [];
  });

  it("connects with stored auth and forwards realtime updates to subscribers", async () => {
    window.localStorage.setItem("shilabs.accessToken", "access-token");
    window.localStorage.setItem("shilabs.user", JSON.stringify(user));
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve(user)
        })
      )
    );
    vi.stubGlobal("WebSocket", MockWebSocket);
    const onEvent = vi.fn();

    render(
      <AuthProvider>
        <RealtimeProvider>
          <Subscriber onEvent={onEvent} />
        </RealtimeProvider>
      </AuthProvider>
    );

    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
    const socket = MockWebSocket.instances[0];
    expect(socket?.url).toContain("/realtime?token=access-token");
    act(() => {
      socket?.emitOpen();
      socket?.emitMessage({
        type: "realtime:update",
        entityType: "lead",
        action: "domain-event-processed",
        leadId: "lead_1",
        occurredAt: new Date().toISOString()
      });
    });

    await waitFor(() =>
      expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ entityType: "lead", leadId: "lead_1" }))
    );

    act(() => {
      socket?.emitMessage({
        type: "realtime:update",
        entityType: "activity",
        action: "created",
        leadId: "lead_1",
        occurredAt: new Date().toISOString()
      });
    });

    await waitFor(() =>
      expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ entityType: "activity", leadId: "lead_1" }))
    );
  });
});
