import type React from "react";

export function Badge({
  children,
  tone = "neutral",
  className
}: {
  children: React.ReactNode;
  tone?: "neutral" | "accent" | "success" | "warning" | "danger";
  className?: string;
}): React.JSX.Element {
  return (
    <span className={`ui-badge ui-badge-${tone}${className ? ` ${className}` : ""}`}>
      {children}
    </span>
  );
}
