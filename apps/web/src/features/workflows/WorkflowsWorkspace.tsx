import type React from "react";
import { useEffect, useState } from "react";
import type {
  PublicUser,
  WorkflowDashboardDto,
  WorkflowDetailDto,
  WorkflowStatusName
} from "@shilabs/shared-types";
import {
  Activity,
  Archive,
  ArrowLeft,
  CheckCircle2,
  CirclePause,
  Clock3,
  GitBranch,
  History,
  Play,
  Plus,
  Search,
  XCircle
} from "lucide-react";
import type { WorkflowDetailTab } from "../../app/routing.js";
import { Badge, Button, Card, Modal, Select } from "../../components/ui/index.js";
import { StateBlock } from "../../components/StateBlock.js";
import {
  createWorkflow,
  getWorkflow,
  listWorkflows,
  updateWorkflowStatus
} from "../../services/api-client.js";
import { WorkflowBuilder } from "./WorkflowBuilder.js";

function tone(status: WorkflowStatusName): "neutral" | "success" | "warning" {
  return status === "PUBLISHED" ? "success" : status === "PAUSED" ? "warning" : "neutral";
}
function date(value: string | null): string {
  return value
    ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(
        new Date(value)
      )
    : "Not yet";
}
export function WorkflowsWorkspace({
  accessToken,
  currentUser,
  initialWorkflowId,
  initialTab,
  onRouteChange
}: {
  accessToken: string;
  currentUser: PublicUser;
  initialWorkflowId: string | null;
  initialTab?: WorkflowDetailTab;
  onRouteChange: (id: string | null, tab?: WorkflowDetailTab) => void;
}): React.JSX.Element {
  const [dashboard, setDashboard] = useState<WorkflowDashboardDto | null>(null);
  const [detail, setDetail] = useState<WorkflowDetailDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("ALL");
  const canManage = currentUser.role === "ADMIN" || currentUser.role === "SALES_MANAGER";
  const tab = initialTab ?? "overview";
  const loadList = async (): Promise<void> => {
    setLoading(true);
    setError(false);
    try {
      setDashboard(await listWorkflows(accessToken));
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  };
  const loadDetail = async (): Promise<void> => {
    if (!initialWorkflowId) {
      setDetail(null);
      return;
    }
    setLoading(true);
    setError(false);
    try {
      setDetail(await getWorkflow(accessToken, initialWorkflowId));
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void (initialWorkflowId ? loadDetail() : loadList());
  }, [accessToken, initialWorkflowId]);
  if (loading && !dashboard && !detail)
    return (
      <StateBlock
        title="Loading workflows"
        detail="Reading persisted workflow versions and executions."
      />
    );
  if (error)
    return (
      <StateBlock
        title="Workflows unavailable"
        detail="The workspace workflow data could not be loaded."
        action={
          <Button onClick={() => void (initialWorkflowId ? loadDetail() : loadList())}>
            Retry
          </Button>
        }
      />
    );
  if (initialWorkflowId && detail)
    return (
      <WorkflowDetail
        accessToken={accessToken}
        workflow={detail}
        canManage={canManage}
        tab={tab}
        onBack={() => onRouteChange(null)}
        onTab={(next) => onRouteChange(detail.id, next)}
        onChanged={loadDetail}
      />
    );
  const items = (dashboard?.workflows ?? []).filter(
    (item) =>
      (status === "ALL" || item.status === status) &&
      `${item.name} ${item.description}`.toLowerCase().includes(query.toLowerCase())
  );
  return (
    <section className="agents-workspace">
      <header className="agents-toolbar">
        <div>
          <span className="section-eyebrow">AUTOMATION / WORKFLOWS</span>
          <h2>Workflows</h2>
          <p>Coordinate durable CRM actions, people, and reusable agents.</p>
        </div>
        {canManage ? (
          <Button variant="primary" onClick={() => setCreateOpen(true)}>
            <Plus size={16} /> New workflow
          </Button>
        ) : null}
      </header>
      <section className="agent-kpis">
        <Card>
          <span>Total workflows</span>
          <GitBranch size={18} />
          <strong>{dashboard?.summary.total ?? 0}</strong>
        </Card>
        <Card>
          <span>Published</span>
          <Play size={18} />
          <strong>{dashboard?.summary.published ?? 0}</strong>
        </Card>
        <Card>
          <span>Executions</span>
          <Activity size={18} />
          <strong>{dashboard?.summary.executions ?? 0}</strong>
        </Card>
        <Card>
          <span>Running / waiting</span>
          <Clock3 size={18} />
          <strong>{dashboard?.summary.running ?? 0}</strong>
        </Card>
      </section>
      <Card className="agent-directory">
        <div className="agent-directory-toolbar">
          <label className="agent-search">
            <Search size={16} />
            <input
              aria-label="Search workflows"
              placeholder="Search workflows"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <Select
            ariaLabel="Workflow status"
            value={status}
            options={[
              { value: "ALL", label: "All statuses" },
              ...["DRAFT", "PUBLISHED", "PAUSED", "ARCHIVED"].map((value) => ({
                value,
                label: value
              }))
            ]}
            onChange={setStatus}
          />
        </div>
        <div className="agent-table">
          <div className="workflow-table-row workflow-table-head">
            <span>Workflow</span>
            <span>Status</span>
            <span>Versions</span>
            <span>Executions</span>
            <span>Last execution</span>
          </div>
          {items.map((workflow) => (
            <button
              className="workflow-table-row"
              key={workflow.id}
              onClick={() => onRouteChange(workflow.id, "overview")}
              type="button"
            >
              <span className="agent-identity">
                <i>
                  <GitBranch size={17} />
                </i>
                <span>
                  <strong>{workflow.name}</strong>
                  <small>{workflow.description}</small>
                </span>
              </span>
              <Badge tone={tone(workflow.status)}>{workflow.status}</Badge>
              <span>{workflow.versions.length}</span>
              <span>{workflow.executionCount}</span>
              <span>{date(workflow.lastExecutedAt)}</span>
            </button>
          ))}
          {!items.length ? (
            <StateBlock
              title="No workflows found"
              detail="Create a workflow or adjust the current filters."
            />
          ) : null}
        </div>
      </Card>
      <CreateModal
        accessToken={accessToken}
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(id) => {
          setCreateOpen(false);
          onRouteChange(id, "builder");
        }}
      />
    </section>
  );
}
function WorkflowDetail({
  accessToken,
  workflow,
  canManage,
  tab,
  onBack,
  onTab,
  onChanged
}: {
  accessToken: string;
  workflow: WorkflowDetailDto;
  canManage: boolean;
  tab: WorkflowDetailTab;
  onBack: () => void;
  onTab: (tab: WorkflowDetailTab) => void;
  onChanged: () => Promise<void>;
}): React.JSX.Element {
  const [busy, setBusy] = useState(false);
  const action = async (status: "PUBLISHED" | "PAUSED" | "ARCHIVED"): Promise<void> => {
    setBusy(true);
    try {
      await updateWorkflowStatus(accessToken, workflow.id, status);
      await onChanged();
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="agent-detail">
      <header className="agent-detail-header">
        <Button onClick={onBack}>
          <ArrowLeft size={15} /> Back to workflows
        </Button>
        <div className="agent-detail-title">
          <i className="agent-detail-icon">
            <GitBranch size={21} />
          </i>
          <div>
            <span>WORKFLOW</span>
            <h2>{workflow.name}</h2>
            <p>{workflow.description}</p>
          </div>
        </div>
        <div className="agent-detail-actions">
          <Badge tone={tone(workflow.status)}>{workflow.status}</Badge>
          {canManage && workflow.status === "PUBLISHED" ? (
            <Button disabled={busy} onClick={() => void action("PAUSED")}>
              <CirclePause size={15} /> Pause
            </Button>
          ) : null}
          {canManage && workflow.status === "PAUSED" ? (
            <Button disabled={busy} onClick={() => void action("PUBLISHED")}>
              <Play size={15} /> Resume
            </Button>
          ) : null}
          {canManage && workflow.status !== "ARCHIVED" ? (
            <Button disabled={busy} onClick={() => void action("ARCHIVED")}>
              <Archive size={15} /> Archive
            </Button>
          ) : null}
        </div>
      </header>
      <nav className="agent-tabs" aria-label="Workflow detail">
        <button className={tab === "overview" ? "active" : ""} onClick={() => onTab("overview")}>
          <Activity size={14} /> Overview
        </button>
        <button className={tab === "builder" ? "active" : ""} onClick={() => onTab("builder")}>
          <GitBranch size={14} /> Builder
        </button>
        <button
          className={tab === "executions" ? "active" : ""}
          onClick={() => onTab("executions")}
        >
          <Clock3 size={14} /> Executions <Badge>{workflow.executions.length}</Badge>
        </button>
        <button className={tab === "versions" ? "active" : ""} onClick={() => onTab("versions")}>
          <History size={14} /> Versions
        </button>
      </nav>
      {tab === "builder" ? (
        <WorkflowBuilder
          accessToken={accessToken}
          workflow={workflow}
          canManage={canManage}
          onChanged={onChanged}
        />
      ) : tab === "executions" ? (
        <ExecutionList workflow={workflow} />
      ) : tab === "versions" ? (
        <section className="agent-version-list">
          {workflow.versions.map((version) => (
            <Card key={version.id}>
              <div>
                <span className="agent-version-number">V{version.version}</span>
                <div>
                  <strong>{version.publishedAt ? "Published version" : "Draft version"}</strong>
                  <small>{date(version.publishedAt ?? version.createdAt)}</small>
                </div>
              </div>
              <Badge tone={version.publishedAt ? "success" : "neutral"}>
                {version.publishedAt ? "IMMUTABLE" : "EDITABLE"}
              </Badge>
            </Card>
          ))}
        </section>
      ) : (
        <section className="agent-detail-grid">
          <Card>
            <header>
              <GitBranch size={16} />
              <h3>Definition</h3>
            </header>
            <dl>
              <div>
                <dt>Current version</dt>
                <dd>
                  {workflow.currentVersion ? `V${String(workflow.currentVersion.version)}` : "None"}
                </dd>
              </div>
              <div>
                <dt>Draft</dt>
                <dd>
                  {workflow.draftVersion ? `V${String(workflow.draftVersion.version)}` : "None"}
                </dd>
              </div>
              <div>
                <dt>Nodes</dt>
                <dd>
                  {workflow.currentVersion?.definition.nodes.length ??
                    workflow.draftVersion?.definition.nodes.length ??
                    0}
                </dd>
              </div>
              <div>
                <dt>Executions</dt>
                <dd>{workflow.executionCount}</dd>
              </div>
            </dl>
          </Card>
          <Card>
            <header>
              <CheckCircle2 size={16} />
              <h3>Runtime safeguards</h3>
            </header>
            <p>
              Every execution is workspace-scoped, idempotent, persisted, and checked against
              Human/AI ownership before side effects.
            </p>
          </Card>
        </section>
      )}
    </section>
  );
}
function ExecutionList({ workflow }: { workflow: WorkflowDetailDto }): React.JSX.Element {
  if (!workflow.executions.length)
    return (
      <StateBlock title="No executions yet" detail="Published workflow runs will appear here." />
    );
  return (
    <section className="agent-execution-list">
      {workflow.executions.map((execution) => (
        <Card key={execution.id}>
          <header>
            <span
              className={`agent-execution-state ${execution.status === "SUCCEEDED" ? "success" : execution.status === "FAILED" ? "failed" : "running"}`}
            >
              {execution.status === "SUCCEEDED" ? (
                <CheckCircle2 size={16} />
              ) : execution.status === "FAILED" ? (
                <XCircle size={16} />
              ) : (
                <Clock3 size={16} />
              )}
            </span>
            <div>
              <strong>{execution.source.replaceAll("_", " ")}</strong>
              <small>{execution.correlationId}</small>
            </div>
            <Badge
              tone={
                execution.status === "SUCCEEDED"
                  ? "success"
                  : execution.status === "FAILED"
                    ? "danger"
                    : "warning"
              }
            >
              {execution.status}
            </Badge>
          </header>
          <div className="agent-execution-meta">
            <span>
              Lead<strong>{execution.leadId ?? "None"}</strong>
            </span>
            <span>
              Steps<strong>{execution.steps.length}</strong>
            </span>
            <span>
              Started<strong>{date(execution.startedAt ?? execution.createdAt)}</strong>
            </span>
          </div>
        </Card>
      ))}
    </section>
  );
}
function CreateModal({
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
  const [saving, setSaving] = useState(false);
  return (
    <Modal
      open={open}
      title="New workflow"
      onClose={onClose}
      footer={
        <Button
          variant="primary"
          disabled={saving || !name.trim() || !description.trim()}
          onClick={() => {
            setSaving(true);
            void createWorkflow(accessToken, { name, description })
              .then((item) => onCreated(item.id))
              .finally(() => setSaving(false));
          }}
        >
          {saving ? "Creating..." : "Create draft"}
        </Button>
      }
    >
      <form className="agent-form" onSubmit={(event) => event.preventDefault()}>
        <label>
          Name
          <input
            value={name}
            maxLength={120}
            onChange={(event) => setName(event.target.value)}
            placeholder="Priority lead follow-up"
          />
        </label>
        <label>
          Description
          <textarea
            value={description}
            maxLength={500}
            rows={4}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Describe when and why this workflow runs."
          />
        </label>
      </form>
    </Modal>
  );
}
