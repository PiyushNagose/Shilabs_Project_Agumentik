import { useCallback, useEffect, useRef, useState } from "react";
import { useRealtime, type RealtimeUpdateEvent } from "../features/realtime/RealtimeProvider.js";

export function usePersistedResource<T>(options: {
  scope: string;
  load: () => Promise<T>;
  accepts: (event: RealtimeUpdateEvent) => boolean;
  errorMessage: string;
}) {
  const { subscribe } = useRealtime();
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const reloadRef = useRef<() => Promise<void>>(() => Promise.resolve());
  const [state, setState] = useState<{
    data: T | null;
    loading: boolean;
    error: string | null;
    updatedAt: string | null;
  }>({ data: null, loading: true, error: null, updatedAt: null });

  useEffect(() => {
    let disposed = false;
    const isDisposed = (): boolean => disposed;
    let pending = false;
    let running: Promise<void> | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setState({ data: null, loading: true, error: null, updatedAt: null });

    // Serialize fetches and retain one trailing invalidation received during a fetch.
    const reload = (): Promise<void> => {
      if (disposed) return Promise.resolve();
      clearTimeout(timer);
      timer = undefined;
      pending = true;
      if (running) return running;
      running = (async () => {
        while (pending && !isDisposed()) {
          pending = false;
          setState((current) => ({ ...current, loading: true }));
          try {
            const data = await optionsRef.current.load();
            if (!isDisposed()) {
              setState({ data, loading: false, error: null, updatedAt: new Date().toISOString() });
            }
          } catch {
            if (!isDisposed()) {
              setState((current) => ({
                ...current,
                loading: false,
                error: optionsRef.current.errorMessage
              }));
            }
          }
        }
      })().finally(() => {
        running = null;
      });
      return running;
    };
    reloadRef.current = reload;
    const unsubscribe = subscribe((event) => {
      if (!optionsRef.current.accepts(event)) return;
      if (running) {
        pending = true;
      } else {
        timer ??= setTimeout(() => {
          void reload();
        }, 200);
      }
    });
    void reload();
    return () => {
      disposed = true;
      clearTimeout(timer);
      unsubscribe();
    };
  }, [options.scope, subscribe]);

  const reload = useCallback(() => reloadRef.current(), []);
  return { ...state, reload };
}
