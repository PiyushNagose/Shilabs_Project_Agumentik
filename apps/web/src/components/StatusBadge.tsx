import type React from "react";

interface StatusBadgeProps {
  className?: string;
  tone?: "neutral" | "hot" | "warm" | "won" | "lost";
  children: React.ReactNode;
}

export function StatusBadge({
  className,
  tone = "neutral",
  children
}: StatusBadgeProps): React.JSX.Element {
  return (
    <span className={`status-badge status-badge-${tone}${className ? ` ${className}` : ""}`}>
      {children}
    </span>
  );
}
