import type React from "react";
import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { Icon } from "./Icon.js";

type ToastTone = "success" | "error";

interface Toast {
  id: string;
  tone: ToastTone;
  title: string;
  detail?: string;
}

interface ToastInput {
  id?: string;
  title: string;
  detail?: string;
}

interface ToastContextValue {
  success: (input: ToastInput) => void;
  error: (input: ToastInput) => void;
  dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

function toastKey(toast: Omit<Toast, "id">): string {
  return `${toast.tone}:${toast.title}:${toast.detail ?? ""}`;
}

export function ToastProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const counter = useRef(0);
  const timers = useRef(new Map<string, number>());

  const dismiss = useCallback((id: string): void => {
    const timer = timers.current.get(id);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      timers.current.delete(id);
    }
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const show = useCallback(
    (tone: ToastTone, input: ToastInput): void => {
      const toast: Toast = {
        id: input.id ?? `toast-${Date.now().toString(36)}-${String(counter.current++)}`,
        tone,
        title: input.title,
        detail: input.detail
      };
      const key = toastKey(toast);

      setToasts((current) => {
        const withoutDuplicate = current.filter((item) => toastKey(item) !== key && item.id !== toast.id);
        return [toast, ...withoutDuplicate].slice(0, 4);
      });

      const existingTimer = timers.current.get(toast.id);
      if (existingTimer !== undefined) window.clearTimeout(existingTimer);
      timers.current.set(
        toast.id,
        window.setTimeout(() => dismiss(toast.id), 5500)
      );
    },
    [dismiss]
  );

  const value = useMemo<ToastContextValue>(
    () => ({
      success: (input) => show("success", input),
      error: (input) => show("error", input),
      dismiss
    }),
    [dismiss, show]
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-viewport" aria-label="Notifications">
        {toasts.map((toast) => (
          <article
            className={`toast toast-${toast.tone}`}
            key={toast.id}
            role={toast.tone === "error" ? "alert" : "status"}
          >
            <Icon name={toast.tone === "error" ? "refresh" : "check"} size={16} />
            <div>
              <strong>{toast.title}</strong>
              {toast.detail ? <span>{toast.detail}</span> : null}
            </div>
            <button
              aria-label={`Dismiss ${toast.title}`}
              onClick={() => dismiss(toast.id)}
              type="button"
            >
              x
            </button>
          </article>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const value = useContext(ToastContext);
  if (!value) {
    throw new Error("useToast must be used within ToastProvider");
  }
  return value;
}
