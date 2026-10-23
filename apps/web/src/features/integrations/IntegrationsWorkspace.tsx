import type React from "react";
import { formatDateTime } from "../../utils/date-time.js";
import { useMemo, useState } from "react";
import type {
  IntegrationCatalogItemDto,
  IntegrationCategoryName,
  IntegrationConnectionDto,
  IntegrationConnectionStatusName
} from "@shilabs/shared-types";
import {
  Bot,
  CalendarDays,
  Check,
  Cloud,
  Mail,
  MessageCircle,
  Phone,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  TriangleAlert,
  Unplug,
  XCircle
} from "lucide-react";
import { Badge, Button, Card, Modal, Select } from "../../components/ui/index.js";
import { StateBlock } from "../../components/StateBlock.js";
import { usePersistedResource } from "../../hooks/usePersistedResource.js";
import { getCalendarOAuthStatus, navigateToCalendarAuthorization, startCalendarOAuth } from "../../services/api/integrations.js";
import {
  connectIntegration,
  disableIntegration,
  disconnectIntegration,
  listIntegrations,
  reconnectIntegration
} from "../../services/api-client.js";

const categories: { value: string; label: string }[] = [
  { value: "ALL", label: "All providers" },
  { value: "CRM", label: "CRM" },
  { value: "EMAIL", label: "Email" },
  { value: "CALENDAR", label: "Calendar" },
  { value: "AI", label: "AI" },
  { value: "MESSAGING", label: "Messaging" },
  { value: "VOICE", label: "Voice" }
];
function icon(category: IntegrationCategoryName): React.ReactNode {
  if (category === "CRM") return <Cloud size={20} />;
  if (category === "EMAIL") return <Mail size={20} />;
  if (category === "CALENDAR") return <CalendarDays size={20} />;
  if (category === "AI") return <Bot size={20} />;
  if (category === "MESSAGING") return <MessageCircle size={20} />;
  return <Phone size={20} />;
}
function tone(
  status: IntegrationConnectionStatusName
): "success" | "warning" | "danger" | "neutral" {
  if (status === "CONNECTED") return "success";
  if (status === "SYNCING" || status === "NEEDS_ATTENTION") return "warning";
  if (status === "FAILED") return "danger";
  return "neutral";
}
function label(status: IntegrationConnectionStatusName): string {
  return status
    .split("_")
    .map((part) => `${part.charAt(0)}${part.slice(1).toLowerCase()}`)
    .join(" ");
}
function when(value: string | null): string {
  return formatDateTime(value, "Not yet");
}

export function IntegrationsWorkspace({ accessToken }: { accessToken: string }): React.JSX.Element {
  const [busy, setBusy] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("ALL");
  const [addOpen, setAddOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const oauthStatus = new URLSearchParams(window.location.search).get("calendarOAuth");
  const resource = usePersistedResource({
    scope: "integrations",
    load: () => listIntegrations(accessToken),
    accepts: (event) => event.entityType === "integration" || event.entityType === "workspace",
    errorMessage: "Connection health could not be loaded."
  });
  const data = resource.data;
  const run = async (key: string, action: () => Promise<unknown>): Promise<void> => {
    setBusy(key);
    setActionError(null);
    try {
      await action();
      await resource.reload();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Connection could not be updated.");
    } finally {
      setBusy(null);
    }
  };
  const connectGoogle = async (fallback: () => Promise<unknown>): Promise<void> => {
    const { enabled } = await getCalendarOAuthStatus(accessToken);
    if (enabled) {
      const { launchToken } = await startCalendarOAuth(accessToken);
      navigateToCalendarAuthorization(launchToken);
    } else {
      await fallback();
    }
  };
  const connections = useMemo(
    () =>
      (data?.connections ?? []).filter(
        (item) =>
          (category === "ALL" || item.category === category) &&
          `${item.name} ${item.description} ${item.provider}`
            .toLowerCase()
            .includes(query.toLowerCase())
      ),
    [category, data, query]
  );
  const available = (data?.catalog ?? []).filter((item) => !item.connected);
  if (resource.loading && !data)
    return (
      <StateBlock
        title="Loading integrations"
        detail="Checking workspace connections and provider health."
      />
    );
  if (resource.error && !data)
    return (
      <StateBlock
        title="Integrations unavailable"
        detail={resource.error}
        action={<Button onClick={() => void resource.reload()}>Retry</Button>}
      />
    );
  return (
    <section className="integrations-workspace">
      {actionError ? <p role="alert" className="integration-error">{actionError}</p> : null}
      {oauthStatus === "connected" ? <p role="status">Google Calendar connected.</p> : null}
      {oauthStatus === "failed" || oauthStatus === "cancelled" ? <p role="alert">Google Calendar reconnect {oauthStatus === "cancelled" ? "was cancelled" : "failed"}. Try reconnecting again.</p> : null}
      <header className="integrations-toolbar">
        <div>
          <span className="section-eyebrow">SYSTEM / INTEGRATIONS</span>
          <h2>Integrations</h2>
          <p>Manage provider connections, health, and synchronization for this workspace.</p>
        </div>
        <Button variant="primary" onClick={() => setAddOpen(true)}>
          <Plus size={16} /> Add integration
        </Button>
      </header>
      <section className="integration-kpis" aria-label="Integration summary">
        <Card>
          <span>Total</span>
          <Settings2 size={18} />
          <strong>{data?.summary.total ?? 0}</strong>
        </Card>
        <Card>
          <span>Connected</span>
          <Check size={18} />
          <strong>{data?.summary.connected ?? 0}</strong>
        </Card>
        <Card>
          <span>Needs attention</span>
          <TriangleAlert size={18} />
          <strong>{data?.summary.needsAttention ?? 0}</strong>
        </Card>
        <Card>
          <span>Failed</span>
          <XCircle size={18} />
          <strong>{data?.summary.failed ?? 0}</strong>
        </Card>
      </section>
      <div className="integration-filters">
        <label className="agent-search">
          <Search size={17} />
          <input
            aria-label="Search integrations"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search integrations"
            value={query}
          />
        </label>
        <Select
          ariaLabel="Filter integration category"
          options={categories}
          value={category}
          onChange={setCategory}
        />
      </div>
      {connections.length === 0 ? (
        <StateBlock
          title="No integrations found"
          detail={
            data?.connections.length
              ? "Adjust the search or category filter."
              : "Add a provider connection to begin."
          }
        />
      ) : (
        <div className="integration-grid">
          {connections.map((connection) => (
            <IntegrationCard
              key={connection.id}
              connection={connection}
              busy={busy === connection.id}
              onReconnect={() =>
                void run(connection.id, () => connection.key === "google-calendar"
                  ? connectGoogle(() => reconnectIntegration(accessToken, connection.id))
                  : reconnectIntegration(accessToken, connection.id))
              }
              onDisable={() =>
                void run(connection.id, () => disableIntegration(accessToken, connection.id))
              }
              onDisconnect={() =>
                void run(connection.id, () => disconnectIntegration(accessToken, connection.id))
              }
            />
          ))}
        </div>
      )}
      <Modal open={addOpen} title="Add integration" onClose={() => setAddOpen(false)}>
        <div className="integration-catalog">
          {available.length === 0 ? (
            <StateBlock
              title="All providers added"
              detail="Every available provider has a workspace connection."
            />
          ) : (
            available.map((item) => (
              <CatalogRow
                key={item.key}
                item={item}
                busy={busy === item.key}
                onConnect={() =>
                  void run(item.key, async () => {
                    if (item.key === "google-calendar") await connectGoogle(() => connectIntegration(accessToken, item.key));
                    else await connectIntegration(accessToken, item.key);
                    setAddOpen(false);
                  })
                }
              />
            ))
          )}
        </div>
      </Modal>
    </section>
  );
}

function IntegrationCard({
  connection,
  busy,
  onReconnect,
  onDisable,
  onDisconnect
}: {
  connection: IntegrationConnectionDto;
  busy: boolean;
  onReconnect: () => void;
  onDisable: () => void;
  onDisconnect: () => void;
}): React.JSX.Element {
  return (
    <Card className="integration-card">
      <header>
        <span className={`integration-icon integration-icon-${connection.category.toLowerCase()}`}>
          {icon(connection.category)}
        </span>
        <Badge tone={tone(connection.status)}>{label(connection.status)}</Badge>
      </header>
      <div>
        <h3>{connection.name}</h3>
        <p>{connection.description}</p>
      </div>
      <dl>
        <div>
          <dt>Last health check</dt>
          <dd>{when(connection.lastCheckedAt)}</dd>
        </div>
        <div>
          <dt>Last sync</dt>
          <dd>{when(connection.lastSyncAt)}</dd>
        </div>
      </dl>
      {connection.lastError ? (
        <p className="integration-error">
          <TriangleAlert size={14} /> {connection.lastError}
        </p>
      ) : null}
      <footer>
        <Button size="sm" disabled={busy} onClick={onReconnect}>
          <RefreshCw size={14} /> {busy ? "Checking" : "Reconnect"}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={busy || connection.status === "DISABLED"}
          onClick={onDisable}
        >
          Disable
        </Button>
        <Button
          aria-label={`Disconnect ${connection.name}`}
          iconOnly
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={onDisconnect}
        >
          <Unplug size={15} />
        </Button>
      </footer>
    </Card>
  );
}
function CatalogRow({
  item,
  busy,
  onConnect
}: {
  item: IntegrationCatalogItemDto;
  busy: boolean;
  onConnect: () => void;
}): React.JSX.Element {
  return (
    <div className="integration-catalog-row">
      <span className={`integration-icon integration-icon-${item.category.toLowerCase()}`}>
        {icon(item.category)}
      </span>
      <div>
        <strong>{item.name}</strong>
        <span>{item.description}</span>
      </div>
      <Badge tone={item.configuredByEnvironment ? "success" : "warning"}>
        {item.configuredByEnvironment ? "Ready" : "Setup required"}
      </Badge>
      <Button size="sm" variant="primary" disabled={busy} onClick={onConnect}>
        {busy ? "Checking" : "Connect"}
      </Button>
    </div>
  );
}
