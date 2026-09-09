import type React from "react";
import { HealthBadge } from "@shilabs/ui";

export function App(): React.JSX.Element {
  return (
    <main className="app-shell">
      <section className="workspace-intro" aria-labelledby="app-title">
        <HealthBadge status="ok" label="M0 scaffold" />
        <h1 id="app-title">Shilabs AI Sales Engine</h1>
        <p>
          In-house sales operating system scaffold for CRM, conversations, qualification,
          follow-ups, meetings, analytics and audit history.
        </p>
      </section>
    </main>
  );
}
