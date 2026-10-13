import type React from "react";
import { useEffect, useMemo, useState } from "react";
import type { AiCommandCenterDto } from "@shilabs/shared-types";
import {
  Bot,
  BrainCircuit,
  CircleDollarSign,
  Clock3,
  Flame,
  Search,
  Sparkles,
  TriangleAlert,
  UserRoundCheck,
  UsersRound
} from "lucide-react";
import { Badge, Button, Card, Select } from "../../components/ui/index.js";
import { StateBlock } from "../../components/StateBlock.js";
import { getAiCommandCenter } from "../../services/api-client.js";
import { useRealtime } from "../realtime/RealtimeProvider.js";

const decisionOptions = [
  { value: "ALL", label: "All recommendations" },
  { value: "ESCALATE", label: "Escalate" },
  { value: "ASK_HUMAN", label: "Ask human" },
  { value: "FOLLOW_UP", label: "Follow up" },
  { value: "WAIT", label: "Wait" },
  { value: "STOP", label: "Stop" }
];

function decisionTone(value: string | null): "danger" | "warning" | "success" | "neutral" {
  if (value === "ESCALATE" || value === "ASK_HUMAN") return "danger";
  if (value === "FOLLOW_UP") return "success";
  if (value === "WAIT") return "warning";
  return "neutral";
}

export function AiCommandCenter({
  accessToken,
  onOpenLead
}: {
  accessToken: string;
  onOpenLead: (leadId: string) => void;
}): React.JSX.Element {
  const [data, setData] = useState<AiCommandCenterDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [query, setQuery] = useState("");
  const [decision, setDecision] = useState("ALL");
  const realtime = useRealtime();
  const load = async (): Promise<void> => {
    setError(false);
    try {
      setData(await getAiCommandCenter(accessToken));
    } catch {
      setError(true);
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
        if (["lead", "activity", "task", "deal", "proposal", "meeting"].includes(event.entityType))
          void load();
      }),
    [accessToken, realtime.subscribe]
  );
  const recommendations = useMemo(
    () =>
      (data?.recommendations ?? []).filter((item) => {
        const matchesDecision = decision === "ALL" || item.decision === decision;
        const text =
          `${item.contactName} ${item.companyName} ${item.ownerName ?? ""} ${item.recommendation}`.toLowerCase();
        return matchesDecision && text.includes(query.toLowerCase());
      }),
    [data, decision, query]
  );

  if (loading && !data)
    return (
      <StateBlock title="Preparing command center" detail="Reading current workspace signals." />
    );
  if (error && !data)
    return (
      <StateBlock
        title="Command center unavailable"
        detail="Manager intelligence could not be loaded."
        action={<Button onClick={() => void load()}>Retry</Button>}
      />
    );
  const metrics = data?.metrics;
  return (
    <section className="command-center-workspace">
      <header className="command-center-header">
        <div>
          <span className="section-eyebrow">AI / COMMAND CENTER</span>
          <h2>Your sales briefing is ready</h2>
          <p>Grounded recommendations from current workspace activity and ownership state.</p>
        </div>
        <Button onClick={() => void load()}>
          <Sparkles size={16} /> Refresh signals
        </Button>
      </header>
      <section className="command-center-kpis" aria-label="Manager metrics">
        <Metric
          label="Active leads"
          value={metrics?.activeLeads ?? 0}
          icon={<UsersRound size={18} />}
        />
        <Metric
          label="Human required"
          value={metrics?.humanRequired ?? 0}
          icon={<TriangleAlert size={18} />}
        />
        <Metric label="AI active" value={metrics?.aiActive ?? 0} icon={<Bot size={18} />} />
        <Metric label="Hot leads" value={metrics?.hotLeads ?? 0} icon={<Flame size={18} />} />
        <Metric
          label="Overdue actions"
          value={metrics?.overdueHumanActions ?? 0}
          icon={<Clock3 size={18} />}
        />
        <Metric
          label="Proposals pending"
          value={metrics?.proposalsPending ?? 0}
          icon={<UserRoundCheck size={18} />}
        />
        <Metric
          label="Meetings today"
          value={metrics?.meetingsToday ?? 0}
          icon={<BrainCircuit size={18} />}
        />
        <Metric
          label="Pipeline value"
          value={Number(metrics?.pipelineValue ?? 0).toLocaleString()}
          icon={<CircleDollarSign size={18} />}
        />
      </section>
      <div className="command-center-signal-grid">
        <Card className="command-center-signal-card">
          <span>Human signals</span>
          <strong>{data?.humanSignals.required ?? 0} require action</strong>
          <p>
            {data?.humanSignals.overdue ?? 0} overdue / {data?.humanSignals.active ?? 0} human
            active
          </p>
        </Card>
        <Card className="command-center-signal-card">
          <span>AI signals</span>
          <strong>{data?.aiSignals.active ?? 0} active</strong>
          <p>
            {data?.aiSignals.paused ?? 0} paused / {data?.aiSignals.stopped ?? 0} stopped
          </p>
        </Card>
      </div>
      <section className="accountability-section" aria-label="Human accountability metrics">
        <header>
          <div>
            <span className="section-eyebrow">HUMAN ACCOUNTABILITY</span>
            <h3>Team outcomes</h3>
          </div>
          <Badge tone="accent">Persisted data</Badge>
        </header>
        <div className="accountability-grid">
          <AccountabilityMetric
            label="Response time"
            value={minutes(data?.humanKpis.averageResponseMinutes)}
          />
          <AccountabilityMetric
            label="First response"
            value={minutes(data?.humanKpis.averageFirstResponseMinutes)}
          />
          <AccountabilityMetric label="Leads handled" value={data?.humanKpis.leadsHandled ?? 0} />
          <AccountabilityMetric
            label="Client responses"
            value={data?.humanKpis.clientResponses ?? 0}
          />
          <AccountabilityMetric label="Proposals sent" value={data?.humanKpis.proposalsSent ?? 0} />
          <AccountabilityMetric
            label="Meetings booked"
            value={data?.humanKpis.meetingsBooked ?? 0}
          />
          <AccountabilityMetric
            label="Follow-ups completed"
            value={data?.humanKpis.followUpsCompleted ?? 0}
          />
          <AccountabilityMetric label="Opportunities" value={data?.humanKpis.opportunities ?? 0} />
          <AccountabilityMetric
            label="Conversion"
            value={`${String(data?.humanKpis.conversionRate ?? 0)}%`}
          />
          <AccountabilityMetric
            label="Revenue"
            value={money(data?.humanKpis.revenue, data?.humanKpis.currency)}
          />
          <AccountabilityMetric
            label="Average deal"
            value={money(data?.humanKpis.averageDealValue, data?.humanKpis.currency)}
          />
        </div>
      </section>
      <section className="accountability-section" aria-label="AI accountability metrics">
        <header>
          <div>
            <span className="section-eyebrow">AI ACCOUNTABILITY</span>
            <h3>Automation outcomes</h3>
          </div>
          <Badge tone="success">Governed</Badge>
        </header>
        <div className="accountability-grid ai">
          <AccountabilityMetric label="Follow-ups sent" value={data?.aiKpis.followUpsSent ?? 0} />
          <AccountabilityMetric
            label="Replies generated"
            value={data?.aiKpis.repliesGenerated ?? 0}
          />
          <AccountabilityMetric
            label="Meetings generated"
            value={data?.aiKpis.meetingsGenerated ?? 0}
          />
          <AccountabilityMetric label="Re-engagement" value={data?.aiKpis.reengagements ?? 0} />
          <AccountabilityMetric
            label="Follow-up conversion"
            value={`${String(data?.aiKpis.followUpConversionRate ?? 0)}%`}
          />
          <AccountabilityMetric label="Leads revived" value={data?.aiKpis.leadsRevived ?? 0} />
          <AccountabilityMetric
            label="Human interventions"
            value={data?.aiKpis.humanInterventions ?? 0}
          />
          <AccountabilityMetric label="AI to human handovers" value={data?.aiKpis.handovers ?? 0} />
        </div>
      </section>
      <Card className="command-center-table-card">
        <header>
          <div>
            <span className="section-eyebrow">PRIORITIZED LEADS</span>
            <h3>Recommended actions</h3>
          </div>
          <Badge>{recommendations.length}</Badge>
        </header>
        <div className="command-center-filters">
          <label className="agent-search">
            <Search size={16} />
            <input
              aria-label="Search command center leads"
              placeholder="Search lead, company or recommendation"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <Select
            ariaLabel="Filter AI recommendation"
            options={decisionOptions}
            value={decision}
            onChange={setDecision}
          />
        </div>
        {recommendations.length === 0 ? (
          <StateBlock
            title="No matching recommendations"
            detail="Adjust the current search or recommendation filter."
          />
        ) : (
          <div className="command-center-table" role="table" aria-label="AI lead recommendations">
            <div className="command-center-row command-center-row-head" role="row">
              <span>Lead</span>
              <span>Stage</span>
              <span>Score</span>
              <span>Ownership</span>
              <span>AI recommendation</span>
              <span />
            </div>
            {recommendations.map((item) => (
              <div className="command-center-row" role="row" key={item.leadId}>
                <span>
                  <strong>{item.contactName}</strong>
                  <small>{item.companyName}</small>
                </span>
                <span>{item.stage}</span>
                <span>
                  <strong>{item.score}</strong>
                  <small>{item.temperature}</small>
                </span>
                <span>
                  <small>Human/AI</small>
                  {item.automationState.replaceAll("_", " ")}
                </span>
                <span className="command-center-recommendation-cell">
                  <Badge tone={decisionTone(item.decision)}>
                    {item.decision?.replaceAll("_", " ") ?? "REVIEW"}
                  </Badge>
                  <small>{item.recommendation}</small>
                </span>
                <Button size="sm" onClick={() => onOpenLead(item.leadId)}>
                  Open lead
                </Button>
              </div>
            ))}
          </div>
        )}
      </Card>
    </section>
  );
}

function Metric({
  label,
  value,
  icon
}: {
  label: string;
  value: string | number;
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

function AccountabilityMetric({
  label,
  value
}: {
  label: string;
  value: string | number;
}): React.JSX.Element {
  return (
    <Card className="accountability-metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </Card>
  );
}

function minutes(value: number | null | undefined): string {
  return value === null || value === undefined ? "Unavailable" : `${String(value)} min`;
}

function money(value: string | undefined, currency: string | undefined): string {
  if (!value || !currency) return "Unavailable";
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    maximumFractionDigits: 0
  }).format(Number(value));
}
