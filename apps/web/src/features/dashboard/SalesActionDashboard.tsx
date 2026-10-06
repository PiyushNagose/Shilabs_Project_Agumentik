import type React from "react";
import { useMemo, useState } from "react";
import type { SalesActionDashboardDto, SalesActionDashboardItemDto } from "@shilabs/shared-types";
import { Icon } from "../../components/Icon.js";
import { StateBlock } from "../../components/StateBlock.js";
import { StatusBadge } from "../../components/StatusBadge.js";
import { useToast } from "../../components/ToastProvider.js";
import {
  acknowledgeNotification,
  apiErrorMessage,
  getSalesActionDashboard,
  retryDomainEvent
} from "../../services/api-client.js";
import type { DetailTab } from "../leads/CrmWorkspace.js";
import { usePersistedResource } from "../../hooks/usePersistedResource.js";

const DASHBOARD_SECTION_PREVIEW_LIMIT = 5;
const PRIORITY_ACTION_PREVIEW_LIMIT = 5;
type DashboardExpandableSection = "approvals" | "handoffs" | "failures" | "meetings";

interface DashboardItemGroup {
  key: string;
  item: SalesActionDashboardItemDto;
  count: number;
}

interface SalesActionDashboardProps {
  accessToken: string;
  onOpenLead: (leadId: string, tab?: DetailTab) => void;
  onOpenOperations?: () => void;
}

function isDomainEventItem(item: SalesActionDashboardItemDto): boolean {
  return item.id.startsWith("domain-event:");
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
  if (!item.lead) {
    if (item.sourceEntityType.startsWith("DomainEventOutbox:")) {
      const eventType = item.sourceEntityType.slice("DomainEventOutbox:".length);
      return `System automation · ${eventType.replaceAll("_", " ")}`;
    }
    return "Platform operation";
  }
  return `${item.lead.company.name} - ${item.lead.contact.firstName} ${item.lead.contact.lastName}`;
}

function dashboardGroupKey(item: SalesActionDashboardItemDto): string {
  return [item.type, item.title, item.detail, item.status, item.severity, item.leadId ?? "workspace"].join(
    "::"
  );
}

function groupDashboardItems(items: SalesActionDashboardItemDto[]): DashboardItemGroup[] {
  const groups = new Map<string, DashboardItemGroup>();
  for (const item of items) {
    const key = dashboardGroupKey(item);
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, { key, item, count: 1 });
      continue;
    }
    const currentDate = new Date(existing.item.occurredAt).getTime();
    const nextDate = new Date(item.occurredAt).getTime();
    groups.set(key, {
      key,
      item: nextDate > currentDate ? item : existing.item,
      count: existing.count + 1
    });
  }
  return [...groups.values()].sort(
    (left, right) => new Date(right.item.occurredAt).getTime() - new Date(left.item.occurredAt).getTime()
  );
}

function DashboardSection({
  emptyDetail,
  items,
  title,
  onOpenLead,
  onAcknowledge,
  onRetry,
  expanded,
  groupRepeated = false,
  onOpenOperations,
  onToggleExpanded
}: {
  emptyDetail: string;
  expanded: boolean;
  groupRepeated?: boolean;
  items: SalesActionDashboardItemDto[];
  title: string;
  onOpenLead: SalesActionDashboardProps["onOpenLead"];
  onAcknowledge: (item: SalesActionDashboardItemDto) => Promise<void>;
  onRetry: (item: SalesActionDashboardItemDto) => Promise<void>;
  onOpenOperations?: () => void;
  onToggleExpanded: () => void;
}): React.JSX.Element {
  const groupedItems = groupRepeated ? groupDashboardItems(items) : items.map((item) => ({
    key: item.id,
    item,
    count: 1
  }));
  const visibleItems = expanded ? groupedItems : groupedItems.slice(0, DASHBOARD_SECTION_PREVIEW_LIMIT);
  const hiddenCount = Math.max(groupedItems.length - visibleItems.length, 0);

  return (
    <section className="dashboard-section" aria-label={title}>
      <header>
        <h3>{title}</h3>
        <StatusBadge>{items.length}</StatusBadge>
      </header>
      {items.length === 0 ? (
        <StateBlock title="Nothing pending" detail={emptyDetail} />
      ) : (
        <>
          <div className="dashboard-card-list">
            {visibleItems.map((group) => (
              <article className="dashboard-action-card" key={group.key}>
                <div className="dashboard-action-main">
                  <div>
                    <strong>{group.item.title}</strong>
                    <span>{leadLabel(group.item)}</span>
                  </div>
                  <div className="dashboard-card-badges">
                    {group.count > 1 ? (
                      <StatusBadge className="status-badge-count">
                        {String(group.count)} items
                      </StatusBadge>
                    ) : null}
                    <StatusBadge tone={statusTone(group.item.severity)}>
                      {group.item.status.replaceAll("_", " ")}
                    </StatusBadge>
                  </div>
                </div>
                <p>
                  {group.item.detail}
                  {isDomainEventItem(group.item) ? (
                    <>
                      <br />
                      <small>Retry after correcting the underlying issue.</small>
                    </>
                  ) : null}
                </p>
                <footer>
                  <span>{formatDate(group.item.occurredAt)}</span>
                  <div className="dashboard-card-actions">
                    {group.item.leadId ? (
                      <button onClick={() => openDashboardItem(group.item, onOpenLead)} type="button">
                        <Icon name="briefcase" size={15} />
                        Open workspace
                      </button>
                    ) : null}
                    {notificationIdFromItem(group.item) ? (
                      <button onClick={() => void onAcknowledge(group.item)} type="button">
                        <Icon name="check" size={15} />
                        Acknowledge
                      </button>
                    ) : null}
                    {isDomainEventItem(group.item) ? (
                      <button onClick={() => void onRetry(group.item)} type="button">
                        <Icon name="refresh" size={15} />
                        Retry
                      </button>
                    ) : null}
                  </div>
                </footer>
              </article>
            ))}
          </div>
          {hiddenCount > 0 ? (
            <div className="dashboard-section-more">
              <span>
                Showing top {String(visibleItems.length)} of {String(groupedItems.length)} groups.
              </span>
              <div className="dashboard-section-more-actions">
                <button onClick={onToggleExpanded} type="button">
                  View all
                </button>
                {groupRepeated && onOpenOperations ? (
                  <button onClick={onOpenOperations} type="button">
                    Open Operations
                  </button>
                ) : null}
              </div>
            </div>
          ) : expanded && groupedItems.length > DASHBOARD_SECTION_PREVIEW_LIMIT ? (
            <div className="dashboard-section-more">
              <span>Showing all {String(groupedItems.length)} groups.</span>
              <div className="dashboard-section-more-actions">
                <button onClick={onToggleExpanded} type="button">
                  Show less
                </button>
                {groupRepeated && onOpenOperations ? (
                  <button onClick={onOpenOperations} type="button">
                    Open Operations
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}

export function SalesActionDashboard({
  accessToken,
  onOpenLead,
  onOpenOperations
}: SalesActionDashboardProps): React.JSX.Element {
  const toast = useToast();
  const {
    data: dashboard, loading, error: refreshError, updatedAt: lastUpdatedAt, reload: loadDashboard
  } = usePersistedResource<SalesActionDashboardDto>({
    scope: accessToken,
    load: () => getSalesActionDashboard(accessToken),
    accepts: (event) => event.type === "realtime:reconnected" ||
      ["dashboard", "lead", "workspace", "notifications", "domain-event"].includes(event.entityType),
    errorMessage: "Action dashboard could not be loaded"
  });
  const [expandedSections, setExpandedSections] = useState<Set<DashboardExpandableSection>>(
    () => new Set()
  );
  const error = refreshError;

  function toggleSection(section: DashboardExpandableSection): void {
    setExpandedSections((current) => {
      const next = new Set(current);
      if (next.has(section)) {
        next.delete(section);
      } else {
        next.add(section);
      }
      return next;
    });
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

  async function retryDashboardItem(item: SalesActionDashboardItemDto): Promise<void> {
    if (!isDomainEventItem(item)) return;
    try {
      await retryDomainEvent(accessToken, item.id.slice("domain-event:".length));
      await loadDashboard();
      toast.success({ title: "Job retry requested", detail: item.title });
    } catch (error) {
      toast.error({ title: "Job retry failed", detail: apiErrorMessage(error, "Retry was not permitted") });
    }
  }

  const totalItems = dashboard?.summary.totalActionItems ?? 0;
  const topItems = useMemo(
    () => dashboard?.actionItems.slice(0, PRIORITY_ACTION_PREVIEW_LIMIT) ?? [],
    [dashboard]
  );

  if (loading && !dashboard) {
    return (
      <section className="action-dashboard">
        <StateBlock title="Loading action dashboard" detail="Fetching persisted action items." />
      </section>
    );
  }

  if (!dashboard) {
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
      {error ? <p className="refresh-error" role="alert">{error}. Showing the last loaded data.</p> : null}
      <header className="dashboard-hero">
        <div>
          <p className="eyebrow">Action Dashboard</p>
          <h2>Sales Engineer Actions</h2>
          <p>Approvals, handoffs and failures from persisted workflow state.</p>
          {lastUpdatedAt ? (
            <small className="dashboard-updated" aria-live="polite">
              Updated {formatDate(lastUpdatedAt)}
            </small>
          ) : null}
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
                    {isDomainEventItem(item) ? (
                      <button onClick={() => void retryDashboardItem(item)} type="button">
                        <Icon name="refresh" size={15} />
                        Retry
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
          expanded={expandedSections.has("approvals")}
          items={dashboard.pendingProposalApprovals}
          title="Proposal Approvals"
          onOpenLead={onOpenLead}
          onAcknowledge={acknowledgeDashboardItem}
          onRetry={retryDashboardItem}
          onToggleExpanded={() => toggleSection("approvals")}
        />
        <DashboardSection
          emptyDetail="No negotiation handoff or human takeover requires attention."
          expanded={expandedSections.has("handoffs")}
          items={dashboard.negotiationAndTakeoverAlerts}
          title="Handoffs & Takeovers"
          onOpenLead={onOpenLead}
          onAcknowledge={acknowledgeDashboardItem}
          onRetry={retryDashboardItem}
          onToggleExpanded={() => toggleSection("handoffs")}
        />
        <DashboardSection
          emptyDetail="No persisted failure is currently marked for attention."
          expanded={expandedSections.has("failures")}
          groupRepeated
          items={dashboard.failuresRequiringAttention}
          title="Failures Requiring Attention"
          onOpenLead={onOpenLead}
          onAcknowledge={acknowledgeDashboardItem}
          onRetry={retryDashboardItem}
          onOpenOperations={onOpenOperations}
          onToggleExpanded={() => toggleSection("failures")}
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
            <>
              <div className="dashboard-card-list">
                {(expandedSections.has("meetings")
                  ? dashboard.meetings.items
                  : dashboard.meetings.items.slice(0, DASHBOARD_SECTION_PREVIEW_LIMIT)
                ).map((item) => (
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
                <p>
                  {item.detail}
                  {isDomainEventItem(item) ? (
                    <>
                      <br />
                      <small>Retry after correcting the underlying issue.</small>
                    </>
                  ) : null}
                </p>
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
              {dashboard.meetings.items.length > DASHBOARD_SECTION_PREVIEW_LIMIT ? (
                <div className="dashboard-section-more">
                  <span>
                    {expandedSections.has("meetings")
                      ? `Showing all ${String(dashboard.meetings.items.length)} items.`
                      : `Showing top ${String(DASHBOARD_SECTION_PREVIEW_LIMIT)} of ${String(
                          dashboard.meetings.items.length
                        )}.`}
                  </span>
                  <button onClick={() => toggleSection("meetings")} type="button">
                    {expandedSections.has("meetings") ? "Show less" : "View all"}
                  </button>
                </div>
              ) : null}
            </>
          )}
        </section>
      </div>
    </section>
  );
}
