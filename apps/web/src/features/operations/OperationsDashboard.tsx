import type React from "react";
import { useEffect, useMemo, useState } from "react";
import type {
  OperationsDashboardDto,
  OperationsProviderHealthDto,
  OperationsProviderErrorDto,
  OperationsUsageIndicatorDto
} from "@shilabs/shared-types";
import { Icon } from "../../components/Icon.js";
import { StateBlock } from "../../components/StateBlock.js";
import { StatusBadge } from "../../components/StatusBadge.js";
import { getOperationsDashboard } from "../../services/api-client.js";

interface OperationsDashboardProps {
  accessToken: string;
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

function ProviderHealthCard({ item }: { item: OperationsProviderHealthDto }): React.JSX.Element {
  return (
    <article className="operations-card">
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

function ProviderErrorCard({ error }: { error: OperationsProviderErrorDto }): React.JSX.Element {
  return (
    <article className="operations-row-card">
      <div>
        <strong>{error.source}</strong>
        <span>
          {error.provider} - {formatDate(error.occurredAt)}
        </span>
      </div>
      <p>{error.message}</p>
      <StatusBadge tone={errorTone(error.status)}>{error.status.replaceAll("_", " ")}</StatusBadge>
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
  const [dashboard, setDashboard] = useState<OperationsDashboardDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function loadDashboard(): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      setDashboard(await getOperationsDashboard(accessToken));
    } catch {
      setError("Operations dashboard could not be loaded");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadDashboard();
  }, [accessToken]);

  const unhealthyProviders = useMemo(
    () =>
      dashboard?.providerHealth.filter(
        (item) => item.status !== "CONFIGURED" || item.lastError !== null || item.missingConfig.length > 0
      ).length ?? 0,
    [dashboard]
  );

  if (loading) {
    return (
      <section className="operations-dashboard">
        <StateBlock title="Loading operations" detail="Reading persisted integration and job state." />
      </section>
    );
  }

  if (error || !dashboard) {
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
      <header className="dashboard-hero operations-hero">
        <div>
          <p className="eyebrow">Operations</p>
          <h2>Integration Health</h2>
          <p>Provider status, job state, sync issues and real usage evidence.</p>
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
        <div className="operations-grid">
          {dashboard.providerHealth.map((item) => (
            <ProviderHealthCard item={item} key={item.key} />
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
          <div className="dashboard-card-list">
            {dashboard.work.recentProblemItems.map((item) => (
              <ProviderErrorCard
                error={{
                  id: item.id,
                  provider: "WORKER",
                  source: item.type,
                  status: item.status,
                  message: item.detail,
                  occurredAt: item.occurredAt
                }}
                key={item.id}
              />
            ))}
          </div>
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
          <div className="dashboard-card-list">
            {dashboard.providerErrors.map((item) => (
              <ProviderErrorCard error={item} key={`${item.source}:${item.id}`} />
            ))}
          </div>
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
