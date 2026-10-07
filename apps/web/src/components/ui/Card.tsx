import type React from "react";

export function Card({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>): React.JSX.Element {
  return <div className={`ui-card${className ? ` ${className}` : ""}`} {...props} />;
}
