import type React from "react";
import { ExecutionTiming } from "../../components/ExecutionTiming.js";
import { executionStatusLabel, formatDateTime } from "../../utils/date-time.js";
import { useEffect, useMemo, useState } from "react";
import type {
  AgentDetailDto,
  AgentExecutionDto,
  AgentStatusName,
  AgentTypeName,
  PublicUser
} from "@shilabs/shared-types";
import type { AgentDetailTab } from "../../app/routing.js";
import {
  Activity,
  Archive,
  ArrowLeft,
  Bot,
  BrainCircuit,
  CheckCircle2,
  CirclePause,
  Clock3,
  Database,
  FileSearch,
  GitBranch,
  History,
  ListChecks,
  Pencil,
  Play,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
  Wrench,
  XCircle
} from "lucide-react";
import { Badge, Button, Card, Modal, Select } from "../../components/ui/index.js";
import { StateBlock } from "../../components/StateBlock.js";
import { usePersistedResource } from "../../hooks/usePersistedResource.js";
import { isWorkspaceManager } from "../auth/workspace-access.js";
import {
  createAgent,
  getAgent,
  listAgents,
  updateAgent,
  updateAgentStatus
} from "../../services/api-client.js";
import { AgentComposer } from "./AgentComposer.js";

const typeLabels: Record<AgentTypeName, string> = {
  OUTREACH: "Outreach",
  REPLY_UNDERSTANDING: "Reply understanding",
  QUALIFICATION: "Qualification",
  PROPOSAL: "Proposal",
  MEETING: "Meeting",
  VOICE: "Voice",
  WHATSAPP: "WhatsApp",
  SALES_COPILOT: "Sales copilot"
};

function statusTone(status: AgentStatusName): "neutral" | "success" | "warning" {
  return status === "ACTIVE" ? "success" : status === "PAUSED" ? "warning" : "neutral";
}

function formatDate(value: string | null): string {
  return formatDateTime(value, "Not yet");
}

function duration(value: number | null, status?: string): string {
  if (value === null) return status === "QUEUED" ? "Not started" : "Not recorded";
  if (value < 1000) return `${String(value)} ms`;
  return `${String(Math.round(value / 100) / 10)}s`;
}

function businessLabel(value: string): string {
  const label = value.replaceAll("_", " ").toLowerCase();
  return `${label.charAt(0).toUpperCase()}${label.slice(1)}`;
}

function configReference(value: unknown, keys: readonly string[], fallback: string): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fallback;
  const record = value as Record<string, unknown>;
  for (const key of keys) {
    const entry = record[key];
    if (typeof entry === "string" && entry.trim()) return entry.replaceAll("_", " ");
    if (typeof entry === "number" || typeof entry === "boolean") return String(entry);
    if (Array.isArray(entry)) {
      const safeItems = entry.filter(
        (item): item is string | number => typeof item === "string" || typeof item === "number"
      );
      if (safeItems.length) return safeItems.slice(0, 4).join(", ");
    }
  }
  return fallback;
}

function evaluationOutcome(execution: AgentExecutionDto): string {
  if (execution.status === "QUEUED") return execution.nextRunAt ? "Scheduled" : "Queued";
  if (execution.status === "WAITING") return "Waiting";
  if (execution.status === "HUMAN_REQUIRED") return "Needs your response";
  if (execution.status === "CANCELED") return "Canceled";
  const evaluation = execution.evaluation;
  if (evaluation && typeof evaluation === "object" && !Array.isArray(evaluation)) {
    const record = evaluation as Record<string, unknown>;
    if (typeof record.outcome === "string") {
      const outcome = record.outcome.replaceAll("_", " ").toLowerCase();
      return `${outcome.charAt(0).toUpperCase()}${outcome.slice(1)}`;
    }
  }
  return execution.status === "SUCCEEDED"
    ? "Passed"
    : execution.status === "FAILED"
      ? "Needs review"
      : "Pending";
}

function AgentCreateModal({
  accessToken,
  open,
  onClose,
  onCreated
}: {
  accessToken: string;
  open: boolean;
  onClose: () => void;
  onCreated: (id: string) => void;
}): React.JSX.Element {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [type, setType] = useState<AgentTypeName>("OUTREACH");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (): Promise<void> => {
    setSaving(true);
    setError(null);
    try {
      const agent = await createAgent(accessToken, {
        name,
        description,
        type,
        definition: { capability: type.toLowerCase(), managed: false }
      });
      onCreated(agent.id);
    } catch {
      setError("The agent could not be created.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      title="New agent"
      onClose={onClose}
      footer={
        <Button
          disabled={saving || !name.trim() || !description.trim()}
          variant="primary"
          onClick={() => void submit()}
        >
          {saving ? "Creating..." : "Create draft"}
        </Button>
      }
    >
      <form
        className="agent-form agent-create-form"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <label>
          Name
          <input
            value={name}
            maxLength={120}
            onChange={(event) => setName(event.target.value)}
            placeholder="Regional outreach"
          />
        </label>
        <label>
          Capability
          <Select
            ariaLabel="Agent capability"
            onChange={(value) => setType(value as AgentTypeName)}
            options={Object.entries(typeLabels).map(([value, label]) => ({ value, label }))}
            value={type}
          />
        </label>
        <label>
          Description
          <textarea
            value={description}
            maxLength={500}
            rows={4}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Describe the business responsibility."
          />
        </label>
        {error ? (
          <p className="agent-form-error" role="alert">
            {error}
          </p>
        ) : null}
      </form>
    </Modal>
  );
}

function AgentEditModal({
  accessToken,
  agent,
  open,
  onClose,
  onSaved
}: {
  accessToken: string;
  agent: AgentDetailDto;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}): React.JSX.Element {
  const [name, setName] = useState(agent.name);
  const [description, setDescription] = useState(agent.description);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (): Promise<void> => {
    setSaving(true);
    setError(null);
    try {
      await updateAgent(accessToken, agent.id, { name, description });
      onSaved();
    } catch {
      setError("The agent could not be updated.");
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal
      open={open}
      title="Edit agent"
      onClose={onClose}
      footer={
        <Button
          disabled={saving || !name.trim() || !description.trim()}
          variant="primary"
          onClick={() => void submit()}
        >
          {saving ? "Saving..." : "Save new version"}
        </Button>
      }
    >
      <form
        className="agent-form"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <label>
          Name
          <input value={name} maxLength={120} onChange={(event) => setName(event.target.value)} />
        </label>
        <label>
          Description
          <textarea
            value={description}
            maxLength={500}
            rows={4}
            onChange={(event) => setDescription(event.target.value)}
          />
        </label>
        <p>
          Saving creates a new immutable version. Existing execution records keep their original
          version reference.
        </p>
        {error ? (
          <p className="agent-form-error" role="alert">
            {error}
          </p>
        ) : null}
      </form>
    </Modal>
  );
}

function AgentsList({
  accessToken,
  currentUser,
  onOpen
}: {
  accessToken: string;
  currentUser: PublicUser;
  onOpen: (id: string) => void;
}): React.JSX.Element {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<AgentStatusName | "ALL">("ALL");
  const [createOpen, setCreateOpen] = useState(false);
  const resource = usePersistedResource({
    scope: "agents",
    load: () => listAgents(accessToken),
    accepts: (event) =>
      [
        "agent",
        "workspace",
        "lead",
        "conversation",
        "qualification",
        "proposal",
        "meeting",
        "domain-event",
        "operations"
      ].includes(event.entityType),
    errorMessage: "Agent data could not be loaded."
  });
  const agents = useMemo(
    () =>
      resource.data?.agents.filter(
        (agent) =>
          (status === "ALL" || agent.status === status) &&
          `${agent.name} ${agent.description} ${agent.type}`
            .toLowerCase()
            .includes(query.trim().toLowerCase())
      ) ?? [],
    [query, resource.data, status]
  );
  const canManage = isWorkspaceManager(currentUser);

  return (
    <div className="agents-workspace">
      <section className="agents-toolbar">
        <div>
          <span className="records-eyebrow">AI / AGENTS</span>
          <h2>Agents</h2>
          <p>Manage reusable AI capabilities and review business-visible execution outcomes.</p>
        </div>
        {canManage ? (
          <Button variant="primary" onClick={() => setCreateOpen(true)}>
            <Plus size={15} /> New agent
          </Button>
        ) : null}
      </section>
      {resource.data ? (
        <section className="agent-kpis" aria-label="Agent summary">
          <Card>
            <Bot size={17} />
            <span>Total agents</span>
            <strong>{resource.data.summary.totalAgents}</strong>
          </Card>
          <Card>
            <Play size={17} />
            <span>Active</span>
            <strong>{resource.data.summary.activeAgents}</strong>
          </Card>
          <Card>
            <Activity size={17} />
            <span>Executions</span>
            <strong>{resource.data.summary.totalExecutions}</strong>
          </Card>
          <Card>
            <ShieldCheck size={17} />
            <span>Success rate</span>
            <strong>
              {resource.data.summary.successRate === null
                ? "-"
                : `${String(resource.data.summary.successRate)}%`}
            </strong>
          </Card>
        </section>
      ) : null}
      <section className="agent-directory ui-card">
        <header className="agent-directory-toolbar">
          <div className="agent-search">
            <Search size={16} />
            <input
              aria-label="Search agents"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search agents"
            />
          </div>
          <Select
            ariaLabel="Filter by status"
            value={status}
            onChange={(value) => setStatus(value as AgentStatusName | "ALL")}
            options={[
              { value: "ALL", label: "All statuses" },
              { value: "ACTIVE", label: "Active" },
              { value: "PAUSED", label: "Paused" },
              { value: "DRAFT", label: "Draft" },
              { value: "ARCHIVED", label: "Archived" }
            ]}
          />
        </header>
        {resource.loading && !resource.data ? (
          <StateBlock title="Loading agents" detail="Fetching capability and execution data." />
        ) : resource.error ? (
          <StateBlock
            title="Agents unavailable"
            detail={resource.error}
            action={<Button onClick={() => void resource.reload()}>Retry</Button>}
          />
        ) : agents.length === 0 ? (
          <StateBlock
            title="No agents found"
            detail="Adjust the current search or status filter."
          />
        ) : (
          <div className="agent-table" role="table" aria-label="Agents">
            <div className="agent-table-row agent-table-head" role="row">
              <span>Agent</span>
              <span>Capability</span>
              <span>Executions</span>
              <span>Success</span>
              <span>Last execution</span>
              <span>Status</span>
            </div>
            {agents.map((agent) => (
              <button
                className="agent-table-row"
                key={agent.id}
                role="row"
                type="button"
                onClick={() => onOpen(agent.id)}
              >
                <span className="agent-identity">
                  <i>
                    <Sparkles size={16} />
                  </i>
                  <span>
                    <strong>{agent.name}</strong>
                    <small>{agent.description}</small>
                  </span>
                </span>
                <span>{typeLabels[agent.type]}</span>
                <span>{agent.executionCount}</span>
                <span>{agent.successRate === null ? "-" : `${String(agent.successRate)}%`}</span>
                <span>{formatDate(agent.lastExecutedAt)}</span>
                <span>
                  <Badge tone={statusTone(agent.status)}>{agent.status}</Badge>
                </span>
              </button>
            ))}
          </div>
        )}
      </section>
      <AgentCreateModal
        accessToken={accessToken}
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(id) => {
          setCreateOpen(false);
          onOpen(id);
        }}
      />
    </div>
  );
}

function AgentDetail({
  accessToken,
  agentId,
  currentUser,
  initialTab,
  onBack,
  onTabChange
}: {
  accessToken: string;
  agentId: string;
  currentUser: PublicUser;
  initialTab?: AgentDetailTab;
  onBack: () => void;
  onTabChange: (tab: AgentDetailTab) => void;
}): React.JSX.Element {
  const [tab, setTab] = useState<AgentDetailTab>(initialTab ?? "executions");
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const resource = usePersistedResource({
    scope: `agent:${agentId}`,
    load: () => getAgent(accessToken, agentId),
    accepts: (event) =>
      [
        "agent",
        "workspace",
        "lead",
        "conversation",
        "qualification",
        "proposal",
        "meeting",
        "domain-event",
        "operations"
      ].includes(event.entityType),
    errorMessage: "Agent details could not be loaded."
  });
  const agent = resource.data;
  const canManage = isWorkspaceManager(currentUser);
  const openTab = (nextTab: AgentDetailTab): void => {
    setTab(nextTab);
    onTabChange(nextTab);
  };
  useEffect(() => setTab(initialTab ?? "executions"), [agentId, initialTab]);
  const changeStatus = async (next: "ACTIVE" | "PAUSED" | "ARCHIVED"): Promise<void> => {
    setMutationError(null);
    try {
      await updateAgentStatus(accessToken, agentId, next);
      await resource.reload();
    } catch {
      setMutationError("The agent status could not be changed.");
    }
  };

  if (resource.loading && !agent)
    return <StateBlock title="Loading agent" detail="Fetching versions and execution history." />;
  if (resource.error || !agent)
    return (
      <StateBlock
        title="Agent unavailable"
        detail={resource.error ?? "Agent not found."}
        action={<Button onClick={onBack}>Back to agents</Button>}
      />
    );
  return (
    <div className="agent-detail">
      <header className="agent-detail-header">
        <Button variant="ghost" onClick={onBack}>
          <ArrowLeft size={16} /> Agents
        </Button>
        <div className="agent-detail-title">
          <span className="agent-detail-icon">
            <Bot size={22} />
          </span>
          <div>
            <span>{typeLabels[agent.type]}</span>
            <h2>{agent.name}</h2>
            <p>{agent.description}</p>
          </div>
        </div>
        <div className="agent-detail-actions">
          <Badge tone={statusTone(agent.status)}>{agent.status}</Badge>
          <Button variant={canManage ? "primary" : "secondary"} onClick={() => openTab("composer")}>
            <GitBranch size={15} /> {canManage ? "Edit Agent" : "View Composer"}
          </Button>
          {canManage && agent.status !== "ARCHIVED" ? (
            <Button onClick={() => setEditOpen(true)}>
              <Pencil size={15} /> Edit details
            </Button>
          ) : null}
          {canManage && agent.status === "ACTIVE" ? (
            <Button onClick={() => void changeStatus("PAUSED")}>
              <CirclePause size={15} /> Pause
            </Button>
          ) : null}
          {canManage && (agent.status === "PAUSED" || agent.status === "DRAFT") ? (
            <Button variant="primary" onClick={() => void changeStatus("ACTIVE")}>
              <Play size={15} /> {agent.status === "DRAFT" ? "Publish" : "Resume"}
            </Button>
          ) : null}
          {canManage && agent.status !== "ARCHIVED" ? (
            <Button variant="ghost" onClick={() => void changeStatus("ARCHIVED")}>
              <Archive size={15} /> Archive
            </Button>
          ) : null}
        </div>
      </header>
      {mutationError ? (
        <p className="agent-form-error" role="alert">
          {mutationError}
        </p>
      ) : null}
      <section className="agent-detail-kpis">
        <Card>
          <span>Current version</span>
          <strong>v{agent.draftVersion?.version ?? agent.currentVersion?.version ?? "-"}</strong>
          <small>
            {agent.draftVersion
              ? "Draft in progress"
              : agent.currentVersion?.publishedAt
                ? "Published"
                : "Draft"}
          </small>
        </Card>
        <Card>
          <span>Total executions</span>
          <strong>{agent.executionCount}</strong>
          <small>{agent.successfulExecutionCount} successful</small>
        </Card>
        <Card>
          <span>Success rate</span>
          <strong>{agent.successRate === null ? "-" : `${String(agent.successRate)}%`}</strong>
          <small>{agent.failedExecutionCount} failed</small>
        </Card>
        <Card>
          <span>Last execution</span>
          <strong className="compact-value">{formatDate(agent.lastExecutedAt)}</strong>
          <small>Persisted business result</small>
        </Card>
      </section>
      <nav className="agent-tabs agent-detail-tabs" aria-label="Agent detail">
        <button className={tab === "composer" ? "active" : ""} onClick={() => openTab("composer")}>
          <GitBranch size={15} /> Composer {agent.draftVersion ? <Badge>Draft</Badge> : null}
        </button>
        <button className={tab === "overview" ? "active" : ""} onClick={() => openTab("overview")}>
          <Bot size={15} /> Overview
        </button>
        <button
          className={tab === "executions" ? "active" : ""}
          onClick={() => openTab("executions")}
        >
          <History size={15} /> Executions <Badge>{agent.executions.length}</Badge>
        </button>
        <button
          className={tab === "evaluation" ? "active" : ""}
          onClick={() => openTab("evaluation")}
        >
          <ListChecks size={15} /> Evaluation
        </button>
        <button className={tab === "versions" ? "active" : ""} onClick={() => openTab("versions")}>
          <Archive size={15} /> Versions <Badge>{agent.versions.length}</Badge>
        </button>
      </nav>
      {tab === "composer" ? (
        <AgentComposer
          accessToken={accessToken}
          agent={agent}
          canManage={canManage}
          key={agent.draftVersionId ?? agent.currentVersionId ?? agent.id}
          onChanged={resource.reload}
        />
      ) : tab === "overview" ? (
        <AgentOverview agent={agent} />
      ) : tab === "versions" ? (
        <AgentVersions agent={agent} />
      ) : tab === "evaluation" ? (
        <AgentEvaluation agent={agent} canViewTechnical={canManage} />
      ) : (
        <AgentExecutions agent={agent} canViewTechnical={canManage} />
      )}
      <AgentEditModal
        accessToken={accessToken}
        agent={agent}
        open={editOpen}
        onClose={() => setEditOpen(false)}
        onSaved={() => {
          setEditOpen(false);
          void resource.reload();
        }}
      />
    </div>
  );
}

function AgentOverview({ agent }: { agent: AgentDetailDto }): React.JSX.Element {
  const definition = (agent.draftVersion?.definition ?? agent.currentVersion?.definition) as
    { adapter?: string; capability?: string; managed?: boolean } | undefined;
  return (
    <section className="agent-detail-grid">
      <Card>
        <header>
          <Bot size={17} />
          <h3>Capability configuration</h3>
        </header>
        <dl>
          <div>
            <dt>Type</dt>
            <dd>{typeLabels[agent.type]}</dd>
          </div>
          <div>
            <dt>Service adapter</dt>
            <dd>{definition?.adapter ?? "Custom"}</dd>
          </div>
          <div>
            <dt>Capability key</dt>
            <dd>{definition?.capability ?? agent.key}</dd>
          </div>
          <div>
            <dt>Managed mapping</dt>
            <dd>{definition?.managed ? "Existing CRM service" : "Custom definition"}</dd>
          </div>
        </dl>
      </Card>
      <Card>
        <header>
          <ShieldCheck size={17} />
          <h3>Governance</h3>
        </header>
        <p>
          Published versions are immutable. Status changes are audited, workspace-scoped, and
          broadcast through realtime updates.
        </p>
        <p>
          Execution summaries expose business outcomes; provider payloads and technical diagnostics
          remain outside this workspace.
        </p>
      </Card>
    </section>
  );
}

function AgentVersions({ agent }: { agent: AgentDetailDto }): React.JSX.Element {
  return (
    <section className="agent-version-list">
      {agent.versions.map((version) => (
        <Card key={version.id}>
          <div>
            <span className="agent-version-number">v{version.version}</span>
            <div>
              <strong>{version.publishedAt ? "Published version" : "Draft version"}</strong>
              <small>Created {formatDate(version.createdAt)}</small>
            </div>
          </div>
          <Badge tone={version.publishedAt ? "success" : "neutral"}>
            {version.publishedAt ? "IMMUTABLE" : "DRAFT"}
          </Badge>
        </Card>
      ))}
    </section>
  );
}

function AgentExecutions({
  agent,
  canViewTechnical
}: {
  agent: AgentDetailDto;
  canViewTechnical: boolean;
}): React.JSX.Element {
  const [showAll, setShowAll] = useState(false);
  const visibleExecutions = showAll ? agent.executions : agent.executions.slice(0, 10);

  if (agent.executions.length === 0)
    return (
      <section className="ui-card">
        <StateBlock
          title="No executions yet"
          detail="Execution summaries will appear when this capability processes CRM work."
        />
      </section>
    );
  return (
    <section className="agent-execution-list">
      {visibleExecutions.map((execution) => {
        const passed = execution.status === "SUCCEEDED";
        const failed = execution.status === "FAILED";
        return (
          <Card key={execution.id}>
            <header>
              <span
                className={`agent-execution-state ${passed ? "success" : failed ? "failed" : "running"}`}
              >
                {passed ? (
                  <CheckCircle2 size={17} />
                ) : failed ? (
                  <XCircle size={17} />
                ) : (
                  <Clock3 size={17} />
                )}
              </span>
              <div>
                <strong>{execution.summary ?? "Agent execution"}</strong>
                <small>
                  {businessLabel(execution.source)} - Recorded{" "}
                  {formatDate(execution.createdAt ?? execution.startedAt)}
                </small>
              </div>
              <Badge tone={failed ? "danger" : passed ? "success" : "warning"}>
                {executionStatusLabel(execution.status, Boolean(execution.nextRunAt))}
              </Badge>
            </header>
            <div className="agent-execution-meta">
              <ExecutionTiming run={execution} />
              <span>
                Duration <strong>{duration(execution.durationMs, execution.status)}</strong>
              </span>
              <span>
                Entity{" "}
                <strong>{execution.entityType ?? execution.sourceEntityType ?? "Workspace"}</strong>
              </span>
              <span>
                Evaluation <strong>{evaluationOutcome(execution)}</strong>
              </span>
            </div>
            {canViewTechnical ? (
              <details className="agent-execution-reference">
                <summary>Technical details</summary>
                <span>Version reference: {execution.versionId}</span>
                <span>Run reference: {execution.correlationId}</span>
              </details>
            ) : null}
          </Card>
        );
      })}
      {agent.executions.length > 10 ? (
        <div className="agent-list-footer">
          <span>
            Showing {showAll ? "all" : "latest 10 of"} {agent.executions.length} runs
          </span>
          <Button variant="secondary" onClick={() => setShowAll((current) => !current)}>
            {showAll ? "Show latest 10" : `Show all ${String(agent.executions.length)}`}
          </Button>
        </div>
      ) : null}
    </section>
  );
}

function AgentEvaluation({
  agent,
  canViewTechnical
}: {
  agent: AgentDetailDto;
  canViewTechnical: boolean;
}): React.JSX.Element {
  const [showAll, setShowAll] = useState(false);
  const version = agent.draftVersion ?? agent.currentVersion;
  const latest = agent.executions[0] ?? null;
  const visibleExecutions = showAll ? agent.executions : agent.executions.slice(0, 10);
  const definition = version?.definition;
  const references = [
    {
      label: "Model",
      value: configReference(
        version?.modelConfig,
        ["model", "provider", "mode"],
        "Platform governed model"
      ),
      icon: BrainCircuit
    },
    {
      label: "Memory",
      value: configReference(
        definition,
        ["memory", "memoryMode", "context"],
        "Persisted CRM and conversation context"
      ),
      icon: Database
    },
    {
      label: "Knowledge",
      value: configReference(
        version?.knowledgeConfig,
        ["knowledgeBase", "collection", "sources", "retrievalMode"],
        "Approved workspace knowledge"
      ),
      icon: FileSearch
    },
    {
      label: "Tools",
      value: configReference(
        version?.toolsConfig,
        ["tools", "capabilities", "actions"],
        configReference(definition, ["capability", "adapter"], "No tools declared")
      ),
      icon: Wrench
    }
  ];

  return (
    <section className="agent-evaluation-workspace" aria-label="Agent evaluation">
      {canViewTechnical ? (
        <section className="agent-reference-grid" aria-label="Agent capability references">
          {references.map(({ label, value, icon: Icon }) => (
            <Card key={label}>
              <Icon size={17} />
              <span>{label}</span>
              <strong>{value}</strong>
            </Card>
          ))}
        </section>
      ) : (
        <p className="agent-technical-notice">
          Technical configuration is restricted. Business outcomes and evaluation status remain
          available below.
        </p>
      )}

      <Card className="agent-trace-card">
        <header>
          <div>
            <span className="records-eyebrow">EXECUTION GRAPH</span>
            <h3>{latest?.nextRunAt ? "Next scheduled run" : "Latest governed run"}</h3>
          </div>
          <Badge
            tone={
              !latest
                ? "neutral"
                : latest.status === "FAILED"
                  ? "danger"
                  : latest.status === "SUCCEEDED"
                    ? "success"
                    : "warning"
            }
          >
            {latest ? executionStatusLabel(latest.status, Boolean(latest.nextRunAt)) : "No run"}
          </Badge>
        </header>
        {latest ? (
          <div className="agent-execution-trace" aria-label="Latest execution trace">
            <span>
              <small>Source</small>
              <strong>{businessLabel(latest.source)}</strong>
            </span>
            <i aria-hidden="true" />
            <span>
              <small>Agent</small>
              <strong>{agent.name}</strong>
            </span>
            <i aria-hidden="true" />
            <span>
              <small>Evaluation</small>
              <strong>{evaluationOutcome(latest)}</strong>
            </span>
          </div>
        ) : (
          <StateBlock title="No execution trace" detail="A trace appears after the first run." />
        )}
        {latest ? <ExecutionTiming run={latest} /> : null}
      </Card>

      <Card className="agent-evaluation-log">
        <header>
          <div>
            <span className="records-eyebrow">EVALUATION LOG</span>
            <h3>Run schedule and outcomes</h3>
          </div>
          <Badge>{agent.executions.length}</Badge>
        </header>
        {agent.executions.length ? (
          <div role="table" aria-label="Agent evaluation log">
            <div className="agent-evaluation-row head" role="row">
              <span>Run</span>
              <span>Outcome</span>
              <span>Duration</span>
              <span>Timing</span>
            </div>
            {visibleExecutions.map((execution) => (
              <div className="agent-evaluation-row" key={execution.id} role="row">
                <span>
                  <strong>{execution.summary ?? "Agent execution"}</strong>
                </span>
                <span className="agent-evaluation-outcome" data-label="Outcome">
                  <Badge
                    tone={
                      execution.status === "FAILED"
                        ? "danger"
                        : execution.status === "SUCCEEDED"
                          ? "success"
                          : "warning"
                    }
                  >
                    {evaluationOutcome(execution)}
                  </Badge>
                </span>
                <span data-label="Duration">
                  {duration(execution.durationMs, execution.status)}
                </span>
                <ExecutionTiming run={execution} />
              </div>
            ))}
            {agent.executions.length > 10 ? (
              <div className="agent-list-footer">
                <span>
                  Showing {showAll ? "all" : "latest 10 of"} {agent.executions.length} outcomes
                </span>
                <Button variant="secondary" onClick={() => setShowAll((current) => !current)}>
                  {showAll ? "Show latest 10" : `Show all ${String(agent.executions.length)}`}
                </Button>
              </div>
            ) : null}
          </div>
        ) : (
          <StateBlock title="No evaluations yet" detail="Evaluated runs will appear here." />
        )}
      </Card>
    </section>
  );
}

export function AgentsWorkspace({
  accessToken,
  currentUser,
  initialAgentId,
  initialTab,
  onRouteChange
}: {
  accessToken: string;
  currentUser: PublicUser;
  initialAgentId: string | null;
  initialTab?: AgentDetailTab;
  onRouteChange: (agentId: string | null, tab?: AgentDetailTab) => void;
}): React.JSX.Element {
  return initialAgentId ? (
    <AgentDetail
      accessToken={accessToken}
      agentId={initialAgentId}
      currentUser={currentUser}
      initialTab={initialTab}
      onBack={() => onRouteChange(null)}
      onTabChange={(tab) => onRouteChange(initialAgentId, tab)}
    />
  ) : (
    <AgentsList accessToken={accessToken} currentUser={currentUser} onOpen={onRouteChange} />
  );
}
