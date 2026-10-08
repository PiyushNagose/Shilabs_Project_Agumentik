import { ChevronDown } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

export interface SelectOption {
  label: string;
  value: string;
}

export function Select({
  ariaLabel,
  className,
  disabled = false,
  icon,
  onChange,
  options,
  value
}: {
  ariaLabel: string;
  className?: string;
  disabled?: boolean;
  icon?: ReactNode;
  onChange: (value: string) => void;
  options: SelectOption[];
  value: string;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const selected = options.find((option) => option.value === value) ?? options[0];

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent): void {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  return (
    <div
      className={`themed-select${open ? " open" : ""}${className ? ` ${className}` : ""}`}
      ref={rootRef}
    >
      <select
        aria-label={ariaLabel}
        className="native-select-proxy"
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        tabIndex={-1}
        value={value}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <button
        aria-expanded={open}
        aria-haspopup="listbox"
        className="themed-select-trigger"
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === "Escape") setOpen(false);
        }}
        type="button"
      >
        {icon ? <span className="themed-select-icon">{icon}</span> : null}
        <span className="themed-select-value">{selected?.label ?? ""}</span>
        <ChevronDown size={16} />
      </button>
      {open ? (
        <div className="themed-select-menu" role="listbox" aria-label={ariaLabel}>
          {options.map((option) => (
            <button
              aria-selected={option.value === value}
              className={option.value === value ? "selected" : ""}
              key={option.value}
              onClick={() => {
                onChange(option.value);
                setOpen(false);
              }}
              role="option"
              type="button"
            >
              {option.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
