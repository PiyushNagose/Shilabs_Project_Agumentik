import type React from "react";
import { formatDateTime } from "../../utils/date-time.js";
import { useEffect, useState } from "react";
import type { ManagerAccountabilityReportDto } from "@shilabs/shared-types";
import { Bot, Clock3, RefreshCw, TriangleAlert, UserRoundCheck } from "lucide-react";
import { Badge, Button, Card } from "../../components/ui/index.js";
import { StateBlock } from "../../components/StateBlock.js";
import { getManagerAccountabilityReport } from "../../services/api-client.js";
import { useRealtime } from "../realtime/RealtimeProvider.js";

export function ReportsWorkspace({ accessToken }: { accessToken: string }): React.JSX.Element {
  const [report, setReport] = useState<ManagerAccountabilityReportDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const realtime = useRealtime();

  const load = async (): Promise<void> => {
    setError(null);
    try {
      setReport(await getManagerAccountabilityReport(accessToken));
    } catch {
      setError("Performance report could not be loaded.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [accessToken]);

  useEffect(
    () =>
      realtime.subscribe((event) => {
        if (
          ["lead", "activity", "task", "deal", "proposal", "meeting", "conversation"].includes(
            event.entityType
          )
        )
          void load();
      }),
    [accessToken, realtime.subscribe]
  );

  if (loading && !report)
    return <StateBlock title="Loading performance report" detail="Reading workspace activity." />;
  if (!report)
    return (
      <StateBlock
        title="Performance report unavailable"
        detail={error ?? "No report data is available."}
        action={<Button onClick={() => void load()}>Retry</Button>}
      />
    );

  return (
    <section className="command-center-workspace" aria-label="Manager accountability report">
      {error ? <p className="refresh-error">{error} Showing the last loaded report.</p> : null}
      <header className="command-center-header">
        <div>
          <span className="section-eyebrow">PERFORMANCE / REPORTS</span>
          <h2>Human and AI performance</h2>
          <p>{report.scopeLabel}. Human work and automation are measured separately.</p>
          <small className="dashboard-updated">Updated {formatDate(report.generatedAt)}</small>
        </div>
        <Button onClick={() => void load()}>
          <RefreshCw size={16} /> Refresh report
        </Button>
      </header>

      <section className="command-center-kpis" aria-label="Items needing attention">
        <SummaryMetric
          label="People needed"
          value={report.attention.humanRequired}
          icon={<UserRoundCheck size={18} />}
        />
        <SummaryMetric
          label="Overdue actions"
          value={report.attention.overdueHumanActions}
          icon={<Clock3 size={18} />}
        />
        <SummaryMetric
          label="Proposals to approve"
          value={report.attention.pendingProposalApprovals}
          icon={<TriangleAlert size={18} />}
        />
        <SummaryMetric
          label="Automation issues"
          value={report.attention.automationFailures}
          icon={<Bot size={18} />}
        />
      </section>

      <KpiSection title="Human performance" eyebrow="HUMAN ACCOUNTABILITY" tone="accent">
        <Kpi
          label="Average response time"
          value={minutes(report.humanKpis.averageResponseMinutes)}
        />
        <Kpi
          label="Average first response"
          value={minutes(report.humanKpis.averageFirstResponseMinutes)}
        />
        <Kpi label="Leads handled" value={report.humanKpis.leadsHandled} />
        <Kpi label="Client replies received" value={report.humanKpis.clientResponses} />
        <Kpi label="Proposals sent" value={report.humanKpis.proposalsSent} />
        <Kpi label="Meetings booked" value={report.humanKpis.meetingsBooked} />
        <Kpi label="Follow-up tasks completed" value={report.humanKpis.followUpsCompleted} />
        <Kpi label="Sales opportunities" value={report.humanKpis.opportunities} />
        <Kpi label="Won opportunity rate" value={`${String(report.humanKpis.conversionRate)}%`} />
        <Kpi
          label="Won revenue"
          value={money(report.humanKpis.revenue, report.humanKpis.currency)}
        />
        <Kpi
          label="Average won deal"
          value={money(report.humanKpis.averageDealValue, report.humanKpis.currency)}
        />
      </KpiSection>

      <KpiSection title="AI performance" eyebrow="AI ACCOUNTABILITY" tone="success" ai>
        <Kpi label="Follow-ups sent" value={report.aiKpis.followUpsSent} />
        <Kpi label="Replies generated" value={report.aiKpis.repliesGenerated} />
        <Kpi label="Meetings generated" value={report.aiKpis.meetingsGenerated} />
        <Kpi label="Leads re-engaged" value={report.aiKpis.reengagements} />
        <Kpi
          label="Follow-up conversion"
          value={`${String(report.aiKpis.followUpConversionRate)}%`}
        />
        <Kpi label="Leads revived" value={report.aiKpis.leadsRevived} />
        <Kpi label="Human help requested" value={report.aiKpis.humanInterventions} />
        <Kpi label="Handed to a person" value={report.aiKpis.handovers} />
      </KpiSection>

      <section className="accountability-section" aria-label="Team responsibility">
        <header>
          <div>
            <span className="section-eyebrow">TEAM RESPONSIBILITY</span>
            <h3>Work by team member</h3>
          </div>
        </header>
        {report.team.length === 0 ? (
          <StateBlock title="No active team members" />
        ) : (
          <div className="accountability-team-list">
            {report.team.map((member) => (
              <div className="accountability-team-row" key={member.userId}>
                <span><strong>{member.name}</strong><small>{member.role.replaceAll("_", " ").toLowerCase()}</small></span>
                <span><small>Assigned leads</small><strong>{member.leadsAssigned}</strong></span>
                <span><small>Need a response</small><strong>{member.humanNeeded}</strong></span>
                <span><small>Overdue tasks</small><strong>{member.overdueTasks}</strong></span>
                <span><small>Tasks completed</small><strong>{member.completedTasks}</strong></span>
                <span><small>Emails sent</small><strong>{member.emailsSent}</strong></span>
                <span><small>Won deals</small><strong>{member.wonDeals}</strong></span>
              </div>
            ))}
          </div>
        )}
      </section>
    </section>
  );
}

function KpiSection({
  title,
  eyebrow,
  tone,
  ai = false,
  children
}: {
  title: string;
  eyebrow: string;
  tone: "accent" | "success";
  ai?: boolean;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <section className="accountability-section" aria-label={title}>
      <header>
        <div>
          <span className="section-eyebrow">{eyebrow}</span>
          <h3>{title}</h3>
        </div>
        <Badge tone={tone}>Persisted data</Badge>
      </header>
      <div className={`accountability-grid${ai ? " ai" : ""}`}>{children}</div>
    </section>
  );
}

function SummaryMetric({
  label,
  value,
  icon
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
}): React.JSX.Element {
  return (
    <Card className="command-center-metric">
      <span>{label}</span>
      {icon}
      <strong>{value}</strong>
    </Card>
  );
}

function Kpi({ label, value }: { label: string; value: string | number }): React.JSX.Element {
  return (
    <Card className="accountability-metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </Card>
  );
}

function minutes(value: number | null): string {
  return value === null ? "Not enough data" : `${String(value)} min`;
}

function money(value: string, currency: string): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    maximumFractionDigits: 0
  }).format(Number(value));
}

function formatDate(value: string): string {
  return formatDateTime(value);
}
