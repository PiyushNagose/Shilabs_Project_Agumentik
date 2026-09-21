import type React from "react";

interface StateBlockProps {
  title: string;
  detail?: string;
  action?: React.ReactNode;
}

export function StateBlock({ title, detail, action }: StateBlockProps): React.JSX.Element {
  return (
    <div className="state-block" role="status">
      <strong>{title}</strong>
      {detail ? <span>{detail}</span> : null}
      {action}
    </div>
  );
}
