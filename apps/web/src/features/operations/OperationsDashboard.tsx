import type React from "react";
import { useMemo, useState } from "react";
import type {
  OperationsDashboardDto,
  OperationsProviderHealthDto,
  OperationsProviderErrorDto,
  OperationsUsageIndicatorDto
} from "@shilabs/shared-types";
import { Icon } from "../../components/Icon.js";
import { StateBlock } from "../../components/StateBlock.js";
import { StatusBadge } from "../../components/StatusBadge.js";
import { getOperationsDashboard, retryDomainEvent } from "../../services/api-client.js";
import { usePersistedResource } from "../../hooks/usePersistedResource.js";

interface OperationsDashboardProps {
  accessToken: string;
}

const OPERATIONS_SECTION_PREVIEW_LIMIT = 5;
type OperationsExpandableSection = "work" | "providerErrors";
type ProviderCategory = "CRM" | "Email" | "Calendar" | "Voice" | "WhatsApp" | "AI" | "Platform";

interface ProviderErrorGroup {
  key: string;
  error: OperationsProviderErrorDto;
  count: number;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

function healthTone(status: OperationsProviderHealthDto["status"]): "hot" | "warm" | "neutral" {
  if (status === "ERROR") return "hot";
  if (status === "NOT_CONFIGURED" || status === "DISABLED") return "warm";
  return "neutral";
}

function errorTone(status: string): "hot" | "warm" | "neutral" {
  if (status === "FAILED" || status === "ATTENTION_REQUIRED" || status === "ERROR") return "hot";
  return "warm";
}

function providerCategory(item: OperationsProviderHealthDto): ProviderCategory {
  const text = `${item.key} ${item.label} ${item.provider}`.toLowerCase();
  if (text.includes("zoho") || text.includes("crm")) return "CRM";
  if (text.includes("mail") || text.includes("email") || text.includes("ses")) return "Email";
  if (text.includes("calendar") || text.includes("google")) return "Calendar";
  if (text.includes("voice") || text.includes("call") || text.includes("exotel") || text.includes("twilio")) {
    return "Voice";
  }
  if (text.includes("whatsapp") || text.includes("meta")) return "WhatsApp";
  if (text.includes("ai") || text.includes("gemini") || text.includes("openai")) return "AI";
  return "Platform";
}

function groupProviderHealth(items: OperationsProviderHealthDto[]): {
  category: ProviderCategory;
  items: OperationsProviderHealthDto[];
}[] {
  const order: ProviderCategory[] = ["CRM", "Email", "Calendar", "Voice", "WhatsApp", "AI", "Platform"];
  return order
    .map((category) => ({
      category,
      items: items.filter((item) => providerCategory(item) === category)
    }))
    .filter((group) => group.items.length > 0);
}

function providerErrorKey(error: OperationsProviderErrorDto): string {
  return [error.source, error.provider, error.status, error.message].join("::");
}

function groupProviderErrors(errors: OperationsProviderErrorDto[]): ProviderErrorGroup[] {
  const groups = new Map<string, ProviderErrorGroup>();
  for (const error of errors) {
    const key = providerErrorKey(error);
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, { key, error, count: 1 });
      continue;
    }
    const currentDate = new Date(existing.error.occurredAt).getTime();
    const nextDate = new Date(error.occurredAt).getTime();
    groups.set(key, {
      key,
      error: nextDate > currentDate ? error : existing.error,
      count: existing.count + 1
    });
  }
  return [...groups.values()].sort(
    (left, right) =>
      new Date(right.error.occurredAt).getTime() - new Date(left.error.occurredAt).getTime()
  );
}

function ProviderHealthCard({
  category,
  item
}: {
  category: ProviderCategory;
  item: OperationsProviderHealthDto;
}): React.JSX.Element {
  return (
    <article className="operations-card">
      <p className="operations-card-category">
        <span>{category}</span>
      </p>
      <header>
        <div>
          <strong>{item.label}</strong>
          <span>{item.provider}</span>
        </div>
        <StatusBadge tone={healthTone(item.status)}>{item.status.replaceAll("_", " ")}</StatusBadge>
      </header>
      {item.missingConfig.length > 0 ? (
        <p>Missing: {item.missingConfig.join(", ")}</p>
      ) : item.lastError ? (
        <p>{item.lastError}</p>
      ) : (
        <p>{item.evidence === "CONFIG_ONLY" ? "Configuration evidence only" : "Health check evidence available"}</p>
      )}
      <footer>{formatDate(item.checkedAt)}</footer>
    </article>
  );
}

function ProviderErrorCard({
  count = 1,
  error,
  onRetry,
  retrying
}: {
  count?: number;
  error: OperationsProviderErrorDto;
  onRetry?: () => void;
  retrying?: boolean;
}): React.JSX.Element {
  return (
    <article className="operations-row-card">
      <div>
        <strong>{error.source}</strong>
        <span>
          {error.provider} - {formatDate(error.occurredAt)}
        </span>
      </div>
      <p>{error.message}</p>
      <div className="dashboard-card-badges">
        {count > 1 ? <StatusBadge>{String(count)} items</StatusBadge> : null}
        <StatusBadge tone={errorTone(error.status)}>{error.status.replaceAll("_", " ")}</StatusBadge>
        {onRetry ? (
          <button onClick={onRetry} type="button" disabled={retrying}>
            <Icon name="refresh" size={14} />
            {retrying ? "Retrying" : "Retry"}
          </button>
        ) : null}
      </div>
    </article>
  );
}

function UsageCard({ item }: { item: OperationsUsageIndicatorDto }): React.JSX.Element {
  return (
    <article className="operations-card operations-usage-card">
      <header>
        <div>
          <strong>{item.label}</strong>
          <span>
            {item.provider} - {item.period.replaceAll("_", " ").toLowerCase()}
          </span>
        </div>
      </header>
      <div className="operations-count">
        <strong>{item.count}</strong>
        <span>{item.unit}</span>
      </div>
      <p>{item.costUnavailableReason ?? "Cost evidence unavailable"}</p>
    </article>
  );
}

export function OperationsDashboard({ accessToken }: OperationsDashboardProps): React.JSX.Element {
  const {
    data: dashboard, loading, error: refreshError, updatedAt: lastUpdatedAt, reload: loadDashboard
  } = usePersistedResource<OperationsDashboardDto>({
    scope: accessToken,
    load: () => getOperationsDashboard(accessToken),
    accepts: (event) => event.type === "realtime:reconnected" ||
      ["operations", "domain-event", "workspace", "lead"].includes(event.entityType),
    errorMessage: "Operations dashboard could not be loaded"
  });
  const [expandedSections, setExpandedSections] = useState<Set<OperationsExpandableSection>>(
    () => new Set()
  );
  const [actionError, setError] = useState<string | null>(null);
  const error = actionError ?? refreshError;
  const [retryingErrorId, setRetryingErrorId] = useState<string | null>(null);

  function toggleSection(section: OperationsExpandableSection): void {
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

  async function retryProviderError(item: OperationsProviderErrorDto): Promise<void> {
    const prefix = "Domain event: ";
    if (!item.source.startsWith(prefix)) return;
    setRetryingErrorId(item.id);
    setError(null);
    try {
      await retryDomainEvent(accessToken, item.id);
      await loadDashboard();
    } catch {
      setError("The operational item could not be retried");
    } finally {
      setRetryingErrorId(null);
    }
  }

  const unhealthyProviders = useMemo(
    () =>
      dashboard?.providerHealth.filter(
        (item) => item.status !== "CONFIGURED" || item.lastError !== null || item.missingConfig.length > 0
      ).length ?? 0,
    [dashboard]
  );
  const groupedProblemItems = useMemo(
    () =>
      groupProviderErrors(
        dashboard?.work.recentProblemItems.map((item) => ({
          id: item.id,
          provider: "WORKER",
          source: item.type,
          status: item.status,
          message: item.detail,
          occurredAt: item.occurredAt
        })) ?? []
      ),
    [dashboard]
  );
  const groupedProviderErrors = useMemo(
    () => groupProviderErrors(dashboard?.providerErrors ?? []),
    [dashboard]
  );
  const providerHealthGroups = useMemo(
    () => groupProviderHealth(dashboard?.providerHealth ?? []),
    [dashboard]
  );

  if (loading && !dashboard) {
    return (
      <section className="operations-dashboard">
        <StateBlock title="Loading operations" detail="Reading persisted integration and job state." />
      </section>
    );
  }

  if (!dashboard) {
    return (
      <section className="operations-dashboard">
        <StateBlock
          title="Operations unavailable"
          detail={error ?? "Operational data could not be loaded."}
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
    <section className="operations-dashboard" aria-label="Operations dashboard">
      {error ? <p className="refresh-error" role="alert">{error}. Showing the last loaded data.</p> : null}
      <header className="dashboard-hero operations-hero">
        <div>
          <p className="eyebrow">Operations</p>
          <h2>Integration Health</h2>
          <p>Provider status, job state, sync issues and real usage evidence.</p>
          {lastUpdatedAt ? (
            <small className="dashboard-updated" aria-live="polite">
              Updated {formatDate(lastUpdatedAt)}
            </small>
          ) : null}
        </div>
        <div className="dashboard-total" aria-label="Operational attention items">
          <strong>
            {unhealthyProviders + dashboard.work.failedCount + dashboard.work.attentionRequiredCount}
          </strong>
          <span>attention items</span>
        </div>
      </header>

      <div className="dashboard-summary-grid operations-summary-grid">
        <span>
          <strong>{unhealthyProviders}</strong>
          Provider issues
        </span>
        <span>
          <strong>{dashboard.work.queuedCount}</strong>
          Queued work
        </span>
        <span>
          <strong>{dashboard.work.failedCount + dashboard.work.attentionRequiredCount}</strong>
          Failed/attention work
        </span>
        <span>
          <strong>{dashboard.unsyncedRecords.total}</strong>
          Unsynced mappings
        </span>
      </div>

      <section className="dashboard-section">
        <header>
          <h3>Provider Health</h3>
          <button onClick={() => void loadDashboard()} type="button">
            <Icon name="refresh" size={15} />
            Refresh
          </button>
        </header>
        <div className="operations-provider-health-grid">
          {providerHealthGroups.map((group) => (
            group.items.map((item) => (
              <ProviderHealthCard category={group.category} item={item} key={item.key} />
            ))
          ))}
        </div>
      </section>

      <section className="dashboard-section">
        <header>
          <h3>Queued And Failed Work</h3>
          <StatusBadge>{dashboard.work.recentProblemItems.length}</StatusBadge>
        </header>
        {dashboard.work.recentProblemItems.length === 0 ? (
          <StateBlock title="No queued or failed work" detail="No persisted worker items need attention." />
        ) : (
          <>
            <div className="dashboard-card-list">
              {(expandedSections.has("work")
                ? groupedProblemItems
                : groupedProblemItems.slice(0, OPERATIONS_SECTION_PREVIEW_LIMIT)
              ).map((group) => (
                <ProviderErrorCard
                  count={group.count}
                  error={group.error}
                  key={group.key}
                  onRetry={
                    group.error.status === "FAILED" || group.error.status === "ATTENTION_REQUIRED"
                      ? () => void retryProviderError(group.error)
                      : undefined
                  }
                  retrying={retryingErrorId === group.error.id}
                />
              ))}
            </div>
            {groupedProblemItems.length > OPERATIONS_SECTION_PREVIEW_LIMIT ? (
              <div className="dashboard-section-more">
                <span>
                  {expandedSections.has("work")
                    ? `Showing all ${String(groupedProblemItems.length)} groups.`
                    : `Showing top ${String(OPERATIONS_SECTION_PREVIEW_LIMIT)} of ${String(
                        groupedProblemItems.length
                      )} groups.`}
                </span>
                <button onClick={() => toggleSection("work")} type="button">
                  {expandedSections.has("work") ? "Show less" : "View all"}
                </button>
              </div>
            ) : null}
          </>
        )}
      </section>

      <section className="dashboard-section">
        <header>
          <h3>Provider And Retry Errors</h3>
          <StatusBadge>{dashboard.providerErrors.length}</StatusBadge>
        </header>
        {dashboard.providerErrors.length === 0 ? (
          <StateBlock title="No provider errors" detail="No persisted provider errors are open." />
        ) : (
          <>
            <div className="dashboard-card-list">
              {(expandedSections.has("providerErrors")
                ? groupedProviderErrors
                : groupedProviderErrors.slice(0, OPERATIONS_SECTION_PREVIEW_LIMIT)
              ).map((group) => (
                <ProviderErrorCard
                  count={group.count}
                  error={group.error}
                  key={group.key}
                  onRetry={
                    group.error.source.startsWith("Domain event: ") &&
                    (group.error.status === "FAILED" || group.error.status === "ATTENTION_REQUIRED")
                      ? () => void retryProviderError(group.error)
                      : undefined
                  }
                  retrying={retryingErrorId === group.error.id}
                />
              ))}
            </div>
            {groupedProviderErrors.length > OPERATIONS_SECTION_PREVIEW_LIMIT ? (
              <div className="dashboard-section-more">
                <span>
                  {expandedSections.has("providerErrors")
                    ? `Showing all ${String(groupedProviderErrors.length)} groups.`
                    : `Showing top ${String(OPERATIONS_SECTION_PREVIEW_LIMIT)} of ${String(
                        groupedProviderErrors.length
                      )} groups.`}
                </span>
                <button onClick={() => toggleSection("providerErrors")} type="button">
                  {expandedSections.has("providerErrors") ? "Show less" : "View all"}
                </button>
              </div>
            ) : null}
          </>
        )}
      </section>

      <section className="dashboard-section">
        <header>
          <h3>Usage And Cost Evidence</h3>
          <StatusBadge>{dashboard.usage.length}</StatusBadge>
        </header>
        <div className="operations-grid">
          {dashboard.usage.map((item) => (
            <UsageCard item={item} key={item.key} />
          ))}
        </div>
      </section>
    </section>
  );
}
