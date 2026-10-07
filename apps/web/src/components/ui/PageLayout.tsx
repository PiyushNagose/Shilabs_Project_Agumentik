import type React from "react";

export function PageLayout({
  title,
  description,
  actions,
  children
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="ui-page-layout">
      <header className="ui-page-header">
        <div>
          <h2>{title}</h2>
          {description ? <p>{description}</p> : null}
        </div>
        {actions ? <div className="ui-page-actions">{actions}</div> : null}
      </header>
      {children}
    </div>
  );
}
