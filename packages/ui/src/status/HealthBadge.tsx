import type React from "react";

export interface HealthBadgeProps {
  status: "ok";
  label: string;
}

export function HealthBadge({ label }: HealthBadgeProps): React.JSX.Element {
  return (
    <span
      style={{
        alignItems: "center",
        border: "1px solid #b8d7bd",
        borderRadius: 8,
        color: "#1f6f3a",
        display: "inline-flex",
        fontSize: 14,
        fontWeight: 600,
        gap: 8,
        padding: "6px 10px"
      }}
    >
      <span
        aria-hidden="true"
        style={{
          background: "#2f9e44",
          borderRadius: "50%",
          height: 8,
          width: 8
        }}
      />
      {label}
    </span>
  );
}
