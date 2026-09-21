import type React from "react";

interface StatusBadgeProps {
  tone?: "neutral" | "hot" | "warm" | "won" | "lost";
  children: React.ReactNode;
}

export function StatusBadge({ tone = "neutral", children }: StatusBadgeProps): React.JSX.Element {
  return <span className={`status-badge status-badge-${tone}`}>{children}</span>;
}
