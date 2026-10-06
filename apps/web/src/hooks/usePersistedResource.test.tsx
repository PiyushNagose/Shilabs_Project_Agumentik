/** @vitest-environment happy-dom */
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RealtimeUpdateEvent } from "../features/realtime/RealtimeProvider.js";
import { usePersistedResource } from "./usePersistedResource.js";

const realtime = vi.hoisted(() => ({
  listener: null as ((event: RealtimeUpdateEvent) => void) | null,
  subscribe: vi.fn((listener: (event: RealtimeUpdateEvent) => void) => {
    realtime.listener = listener;
    return () => {
      realtime.listener = null;
    };
  })
}));
vi.mock("../features/realtime/RealtimeProvider.js", () => ({ useRealtime: () => realtime }));
const event: RealtimeUpdateEvent = {
  type: "realtime:update",
  entityType: "lead",
  action: "changed",
  occurredAt: "2026-10-02"
};

describe("persisted resource refresh", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("coalesces event bursts and retains data when a background request fails", async () => {
    const load = vi
      .fn<() => Promise<number>>()
      .mockResolvedValueOnce(5)
      .mockRejectedValue(new Error("offline"));
    const { result } = renderHook(() =>
      usePersistedResource({
        scope: "account",
        load,
        accepts: () => true,
        errorMessage: "Refresh failed"
      })
    );
    await act(() => Promise.resolve());
    expect(result.current.data).toBe(5);
    await act(async () => {
      realtime.listener?.(event);
      realtime.listener?.(event);
      realtime.listener?.(event);
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(load).toHaveBeenCalledTimes(2);
    expect(result.current).toMatchObject({ data: 5, loading: false, error: "Refresh failed" });
  });

  it("serializes in-flight invalidations into one trailing fetch", async () => {
    let finish!: (value: number) => void;
    const load = vi
      .fn<() => Promise<number>>()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          })
      )
      .mockResolvedValue(8);
    const { result } = renderHook(() =>
      usePersistedResource({
        scope: "account",
        load,
        accepts: () => true,
        errorMessage: "Refresh failed"
      })
    );
    await act(async () => {
      realtime.listener?.(event);
      realtime.listener?.(event);
      expect(load).toHaveBeenCalledTimes(1);
      finish(5);
      await Promise.resolve();
    });
    expect(load).toHaveBeenCalledTimes(2);
    expect(result.current.data).toBe(8);
  });

  it("ignores responses from a previous account and unsubscribes on unmount", async () => {
    let finish!: (value: number) => void;
    const load = vi
      .fn<() => Promise<number>>()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          })
      )
      .mockResolvedValue(9);
    const { result, rerender, unmount } = renderHook(
      ({ scope }) =>
        usePersistedResource({
          scope,
          load,
          accepts: () => true,
          errorMessage: "Refresh failed"
        }),
      { initialProps: { scope: "first" } }
    );
    rerender({ scope: "second" });
    await act(async () => {
      finish(5);
      await Promise.resolve();
    });
    expect(result.current.data).toBe(9);
    unmount();
    expect(realtime.listener).toBeNull();
  });
});
