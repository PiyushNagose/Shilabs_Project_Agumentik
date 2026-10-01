import type React from "react";
import { useEffect, useMemo, useState } from "react";
import type { SalesActionDashboardDto, SalesActionDashboardItemDto } from "@shilabs/shared-types";
import { Icon } from "../../components/Icon.js";
import { StateBlock } from "../../components/StateBlock.js";
import { StatusBadge } from "../../components/StatusBadge.js";
import { useToast } from "../../components/ToastProvider.js";
import {
  acknowledgeNotification,
  apiErrorMessage,
  getSalesActionDashboard
} from "../../services/api-client.js";
import type { DetailTab } from "../leads/CrmWorkspace.js";
import { useRealtime } from "../realtime/RealtimeProvider.js";

interface SalesActionDashboardProps {
  accessToken: string;
  onOpenLead: (leadId: string, tab?: DetailTab) => void;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

function statusTone(severity: SalesActionDashboardItemDto["severity"]): "hot" | "warm" | "neutral" {
  if (severity === "CRITICAL") return "hot";
  if (severity === "WARNING") return "warm";
  return "neutral";
}

function targetTab(item: SalesActionDashboardItemDto): DetailTab | undefined {
  if (item.type === "MEETING_CONFIRMATION") return "Meetings";
  if (item.proposalId) return "Proposals";
  if (item.conversationId) return "Conversation";
  return undefined;
}

function openDashboardItem(
  item: SalesActionDashboardItemDto,
  onOpenLead: SalesActionDashboardProps["onOpenLead"]
): void {
  if (item.leadId) {
    onOpenLead(item.leadId, targetTab(item));
  }
}

function notificationIdFromItem(item: SalesActionDashboardItemDto): string | null {
  return item.id.startsWith("notification:") ? item.id.slice("notification:".length) : null;
}

function leadLabel(item: SalesActionDashboardItemDto): string {
  if (!item.lead) return "Operational item";
  return `${item.lead.company.name} - ${item.lead.contact.firstName} ${item.lead.contact.lastName}`;
}

function DashboardSection({
  emptyDetail,
  items,
  title,
  onOpenLead,
  onAcknowledge
}: {
  emptyDetail: string;
  items: SalesActionDashboardItemDto[];
  title: string;
  onOpenLead: SalesActionDashboardProps["onOpenLead"];
  onAcknowledge: (item: SalesActionDashboardItemDto) => Promise<void>;
}): React.JSX.Element {
  return (
    <section className="dashboard-section" aria-label={title}>
      <header>
        <h3>{title}</h3>
        <StatusBadge>{items.length}</StatusBadge>
      </header>
      {items.length === 0 ? (
        <StateBlock title="Nothing pending" detail={emptyDetail} />
      ) : (
        <div className="dashboard-card-list">
          {items.map((item) => (
            <article className="dashboard-action-card" key={item.id}>
              <div className="dashboard-action-main">
                <div>
                  <strong>{item.title}</strong>
                  <span>{leadLabel(item)}</span>
                </div>
                <StatusBadge tone={statusTone(item.severity)}>
                  {item.status.replaceAll("_", " ")}
                </StatusBadge>
              </div>
              <p>{item.detail}</p>
              <footer>
                <span>{formatDate(item.occurredAt)}</span>
                <div className="dashboard-card-actions">
                  {item.leadId ? (
                    <button onClick={() => openDashboardItem(item, onOpenLead)} type="button">
                      <Icon name="briefcase" size={15} />
                      Open workspace
                    </button>
                  ) : null}
                  {notificationIdFromItem(item) ? (
                    <button onClick={() => void onAcknowledge(item)} type="button">
                      <Icon name="check" size={15} />
                      Acknowledge
                    </button>
                  ) : null}
                </div>
              </footer>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

export function SalesActionDashboard({
  accessToken,
  onOpenLead
}: SalesActionDashboardProps): React.JSX.Element {
  const toast = useToast();
  const realtime = useRealtime();
  const [dashboard, setDashboard] = useState<SalesActionDashboardDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function loadDashboard(): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      setDashboard(await getSalesActionDashboard(accessToken));
    } catch {
      setError("Action dashboard could not be loaded");
    } finally {
      setLoading(false);
    }
  }

  async function acknowledgeDashboardItem(item: SalesActionDashboardItemDto): Promise<void> {
    const notificationId = notificationIdFromItem(item);
    if (!notificationId) return;
    try {
      await acknowledgeNotification(accessToken, notificationId);
      await loadDashboard();
      toast.success({ title: "Action acknowledged", detail: item.title });
    } catch (error) {
      toast.error({
        title: "Acknowledgement failed",
        detail: apiErrorMessage(error, "Action item could not be acknowledged")
      });
    }
  }

  useEffect(() => {
    void loadDashboard();
  }, [accessToken]);

  useEffect(
    () =>
      realtime.subscribe((event) => {
        if (
          event.type === "realtime:reconnected" ||
          ["dashboard", "lead", "workspace", "notifications", "domain-event"].includes(event.entityType)
        ) {
          void loadDashboard();
        }
      }),
    [accessToken, realtime]
  );

  const totalItems = dashboard?.summary.totalActionItems ?? 0;
  const topItems = useMemo(() => dashboard?.actionItems.slice(0, 5) ?? [], [dashboard]);

  if (loading) {
    return (
      <section className="action-dashboard">
        <StateBlock title="Loading action dashboard" detail="Fetching persisted action items." />
      </section>
    );
  }

  if (error || !dashboard) {
    return (
      <section className="action-dashboard">
        <StateBlock
          title="Dashboard unavailable"
          detail={error ?? "Action dashboard data could not be loaded."}
          action={
            <button onClick={() => void loadDashboard()} type="button">
              <Icon name="refresh" size={16} />
              Retry
            </button>
          }
        />
      </section>
    );
  }

  return (
    <section className="action-dashboard" aria-label="Sales engineer action dashboard">
      <header className="dashboard-hero">
        <div>
          <p className="eyebrow">Action Dashboard</p>
          <h2>Sales Engineer Actions</h2>
          <p>Approvals, handoffs and failures from persisted workflow state.</p>
        </div>
        <div className="dashboard-total" aria-label="Total action items">
          <strong>{totalItems}</strong>
          <span>open items</span>
        </div>
      </header>

      <div className="dashboard-summary-grid">
        <span>
          <strong>{dashboard.summary.pendingProposalApprovals}</strong>
          Proposal approvals
        </span>
        <span>
          <strong>{dashboard.summary.negotiationAndTakeoverAlerts}</strong>
          Handoff alerts
        </span>
        <span>
          <strong>{dashboard.summary.failuresRequiringAttention}</strong>
          Failures
        </span>
        <span>
          <strong>{dashboard.summary.meetings}</strong>
          Meetings
        </span>
      </div>

      <section className="dashboard-section dashboard-priority" aria-label="Priority actions">
        <header>
          <h3>Priority Actions</h3>
          <button onClick={() => void loadDashboard()} type="button">
            <Icon name="refresh" size={15} />
            Refresh
          </button>
        </header>
        {topItems.length === 0 ? (
          <StateBlock title="No immediate action" detail="No persisted action items are open." />
        ) : (
          <div className="dashboard-card-list dashboard-card-list-compact">
            {topItems.map((item) => (
              <article className="dashboard-action-card" key={item.id}>
                <div className="dashboard-action-main">
                  <div>
                    <strong>{item.title}</strong>
                    <span>{leadLabel(item)}</span>
                  </div>
                  <StatusBadge tone={statusTone(item.severity)}>
                    {item.status.replaceAll("_", " ")}
                  </StatusBadge>
                </div>
                <footer>
                  <span>{formatDate(item.occurredAt)}</span>
                  <div className="dashboard-card-actions">
                    {item.leadId ? (
                      <button onClick={() => openDashboardItem(item, onOpenLead)} type="button">
                        <Icon name="briefcase" size={15} />
                        Open workspace
                      </button>
                    ) : null}
                    {notificationIdFromItem(item) ? (
                      <button onClick={() => void acknowledgeDashboardItem(item)} type="button">
                        <Icon name="check" size={15} />
                        Acknowledge
                      </button>
                    ) : null}
                  </div>
                </footer>
              </article>
            ))}
          </div>
        )}
      </section>

      <div className="dashboard-grid">
        <DashboardSection
          emptyDetail="No proposal is currently waiting for human approval."
          items={dashboard.pendingProposalApprovals}
          title="Proposal Approvals"
          onOpenLead={onOpenLead}
          onAcknowledge={acknowledgeDashboardItem}
        />
        <DashboardSection
          emptyDetail="No negotiation handoff or human takeover requires attention."
          items={dashboard.negotiationAndTakeoverAlerts}
          title="Handoffs & Takeovers"
          onOpenLead={onOpenLead}
          onAcknowledge={acknowledgeDashboardItem}
        />
        <DashboardSection
          emptyDetail="No persisted failure is currently marked for attention."
          items={dashboard.failuresRequiringAttention}
          title="Failures Requiring Attention"
          onOpenLead={onOpenLead}
          onAcknowledge={acknowledgeDashboardItem}
        />
        <section className="dashboard-section" aria-label="Appointments and meetings">
          <header>
            <h3>Appointments & Meetings</h3>
            <StatusBadge>{dashboard.meetings.items.length}</StatusBadge>
          </header>
          {dashboard.meetings.items.length === 0 ? (
            <StateBlock
              title={
                dashboard.meetings.status === "AVAILABLE"
                  ? "No meetings pending"
                  : "Not yet available"
              }
              detail={dashboard.meetings.message}
            />
          ) : (
            <div className="dashboard-card-list">
              {dashboard.meetings.items.map((item) => (
                <article className="dashboard-action-card" key={item.id}>
                  <div className="dashboard-action-main">
                    <div>
                      <strong>{item.title}</strong>
                      <span>{leadLabel(item)}</span>
                    </div>
                    <StatusBadge tone={statusTone(item.severity)}>
                      {item.status.replaceAll("_", " ")}
                    </StatusBadge>
                  </div>
                  <p>{item.detail}</p>
                  <footer>
                    <span>{formatDate(item.occurredAt)}</span>
                    <div className="dashboard-card-actions">
                      {item.leadId ? (
                        <button onClick={() => openDashboardItem(item, onOpenLead)} type="button">
                          <Icon name="briefcase" size={15} />
                          Open meeting
                        </button>
                      ) : null}
                    </div>
                  </footer>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </section>
  );
}
