import type React from "react";
import { useEffect } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { Button } from "./Button.js";

interface OverlayProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
}

function OverlayFrame({
  kind,
  open,
  title,
  onClose,
  children,
  footer
}: OverlayProps & { kind: "modal" | "drawer" }): React.JSX.Element | null {
  useEffect(() => {
    if (!open) return undefined;
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, open]);

  if (!open) return null;
  return createPortal(
    <div className="ui-overlay" role="presentation" onMouseDown={onClose}>
      <section
        aria-labelledby={`${kind}-title`}
        aria-modal="true"
        className={`ui-${kind}`}
        role="dialog"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="ui-overlay-header">
          <h2 id={`${kind}-title`}>{title}</h2>
          <Button
            aria-label={`Close ${title}`}
            iconOnly
            size="sm"
            variant="ghost"
            onClick={onClose}
          >
            <X size={18} />
          </Button>
        </header>
        <div className="ui-overlay-body">{children}</div>
        {footer ? <footer className="ui-overlay-footer">{footer}</footer> : null}
      </section>
    </div>,
    document.body
  );
}

export function Modal(props: OverlayProps): React.JSX.Element | null {
  return <OverlayFrame kind="modal" {...props} />;
}

export function Drawer(props: OverlayProps): React.JSX.Element | null {
  return <OverlayFrame kind="drawer" {...props} />;
}
