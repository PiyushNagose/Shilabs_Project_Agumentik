import type React from "react";
import { useMemo, useState } from "react";
import type {
  WorkflowDefinitionDto,
  WorkflowDetailDto,
  WorkflowNodeDto,
  WorkflowNodeType,
  WorkflowPolicyDto,
  WorkflowPreviewDto,
  WorkflowValidationDto
} from "@shilabs/shared-types";
import {
  Bot,
  CheckCircle2,
  CircleDot,
  Clock3,
  GitBranch,
  Hand,
  Link2,
  ListTodo,
  Mail,
  Play,
  Plus,
  Save,
  Send,
  Square,
  Trash2,
  Wrench,
  XCircle
} from "lucide-react";
import { Badge, Button, Select } from "../../components/ui/index.js";
import {
  previewWorkflow,
  publishWorkflow,
  saveWorkflowDraft,
  validateWorkflow
} from "../../services/api-client.js";

const catalog: { type: WorkflowNodeType; label: string; icon: typeof CircleDot }[] = [
  { type: "TRIGGER", label: "Trigger", icon: CircleDot },
  { type: "CONDITION", label: "Condition", icon: GitBranch },
  { type: "WAIT", label: "Wait", icon: Clock3 },
  { type: "CRM_ACTION", label: "CRM Action", icon: Wrench },
  { type: "TASK", label: "Task", icon: ListTodo },
  { type: "COMMUNICATION", label: "Communication", icon: Mail },
  { type: "AGENT_INVOKE", label: "Agent Invoke", icon: Bot },
  { type: "INTEGRATION_ACTION", label: "Integration Action", icon: Link2 },
  { type: "HUMAN_APPROVAL", label: "Human Approval", icon: Hand },
  { type: "END", label: "End", icon: Square }
];
function defaultConfig(type: WorkflowNodeType): WorkflowNodeDto["config"] {
  if (type === "TRIGGER") return { event: "LEAD_UPDATED" };
  if (type === "CONDITION") return { field: "source", value: "website" };
  if (type === "WAIT") return { durationMinutes: 60 };
  if (type === "CRM_ACTION") return { action: "FOLLOW_UP" };
  if (type === "TASK") return { title: "Follow up with lead", dueMinutes: 60, priority: "NORMAL" };
  if (type === "COMMUNICATION") return { channel: "EMAIL", subject: "", message: "" };
  if (type === "AGENT_INVOKE") return { agentId: "" };
  if (type === "INTEGRATION_ACTION") return { eventType: "REPLY_UNDERSTOOD" };
  if (type === "HUMAN_APPROVAL") return { reason: "Manager approval is required" };
  return { outcome: "COMPLETED" };
}
const fallback: WorkflowDefinitionDto = {
  schemaVersion: 1,
  kind: "WORKFLOW",
  nodes: [
    {
      id: "trigger",
      type: "TRIGGER",
      label: "Lead event",
      position: { x: 260, y: 40 },
      config: { event: "LEAD_UPDATED" }
    },
    {
      id: "end",
      type: "END",
      label: "Complete",
      position: { x: 260, y: 240 },
      config: { outcome: "COMPLETED" }
    }
  ],
  edges: [{ id: "trigger-end", source: "trigger", target: "end", branch: null }]
};
function getDefinition(workflow: WorkflowDetailDto): WorkflowDefinitionDto {
  const value = workflow.draftVersion?.definition ?? workflow.currentVersion?.definition;
  return value?.kind === "WORKFLOW" ? value : fallback;
}
function value(node: WorkflowNodeDto, key: string): string {
  const item = node.config[key];
  return typeof item === "string" ? item : "";
}

export function WorkflowBuilder({
  accessToken,
  workflow,
  canManage,
  onChanged
}: {
  accessToken: string;
  workflow: WorkflowDetailDto;
  canManage: boolean;
  onChanged: () => Promise<void>;
}): React.JSX.Element {
  const [definition, setDefinition] = useState(() => getDefinition(workflow));
  const [policy, setPolicy] = useState<WorkflowPolicyDto>(
    () => workflow.draftVersion?.policyConfig ?? workflow.currentVersion?.policyConfig ?? {}
  );
  const [selectedId, setSelectedId] = useState(definition.nodes[0]?.id ?? "");
  const [busy, setBusy] = useState<string | null>(null);
  const [validation, setValidation] = useState<WorkflowValidationDto | null>(null);
  const [preview, setPreview] = useState<WorkflowPreviewDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const selected = definition.nodes.find((node) => node.id === selectedId) ?? null;
  const outgoing = definition.edges.filter((edge) => edge.source === selectedId);
  const nodeOptions = definition.nodes
    .filter((node) => node.id !== selectedId)
    .map((node) => ({ value: node.id, label: node.label }));
  const invalidIds = useMemo(
    () => new Set(validation?.issues.map((issue) => issue.nodeId).filter(Boolean)),
    [validation]
  );
  const change = (next: WorkflowDefinitionDto): void => {
    setDefinition(next);
    setDirty(true);
    setValidation(null);
    setPreview(null);
  };
  const updateNode = (patch: Partial<WorkflowNodeDto>): void => {
    if (!selected) return;
    change({
      ...definition,
      nodes: definition.nodes.map((node) =>
        node.id === selected.id ? { ...node, ...patch } : node
      )
    });
  };
  const updateConfig = (key: string, next: string | number): void => {
    if (selected) updateNode({ config: { ...selected.config, [key]: next } });
  };
  const moveNode = (id: string, x: number, y: number): void => {
    change({
      ...definition,
      nodes: definition.nodes.map((node) =>
        node.id === id ? { ...node, position: { x: Math.max(12, x), y: Math.max(12, y) } } : node
      )
    });
  };
  const addNode = (type: WorkflowNodeType): void => {
    const id = `${type.toLowerCase()}-${Date.now().toString(36)}`;
    const next: WorkflowNodeDto = {
      id,
      type,
      label: catalog.find((item) => item.type === type)?.label ?? type,
      position: {
        x: 260 + (definition.nodes.length % 2) * 260,
        y: 60 + definition.nodes.length * 120
      },
      config: defaultConfig(type)
    };
    change({ ...definition, nodes: [...definition.nodes, next] });
    setSelectedId(id);
  };
  const run = async (action: "save" | "validate" | "preview" | "publish"): Promise<void> => {
    setBusy(action);
    setError(null);
    try {
      if (action === "save") {
        await saveWorkflowDraft(accessToken, workflow.id, definition, policy);
        setDirty(false);
        await onChanged();
      } else if (action === "validate") {
        if (dirty) await saveWorkflowDraft(accessToken, workflow.id, definition, policy);
        setValidation(await validateWorkflow(accessToken, workflow.id));
        setDirty(false);
        await onChanged();
      } else if (action === "preview")
        setPreview(await previewWorkflow(accessToken, workflow.id, definition));
      else {
        if (dirty) await saveWorkflowDraft(accessToken, workflow.id, definition, policy);
        const checked = await validateWorkflow(accessToken, workflow.id);
        setValidation(checked);
        if (checked.valid) {
          await publishWorkflow(accessToken, workflow.id);
          setDirty(false);
          await onChanged();
        }
      }
    } catch {
      setError(`Workflow ${action} failed.`);
    } finally {
      setBusy(null);
    }
  };
  const canvasHeight = Math.max(660, ...definition.nodes.map((node) => node.position.y + 140));
  return (
    <section className="agent-composer" aria-label="Workflow builder">
      <header className="composer-toolbar">
        <div>
          <h3>Workflow Builder</h3>
          <p>Durable orchestration using existing CRM and Agent capabilities.</p>
        </div>
        <div className="composer-toolbar-actions">
          <Badge tone={dirty ? "warning" : "neutral"}>{dirty ? "UNSAVED" : "SAVED"}</Badge>
          <Button disabled={!canManage || busy !== null} onClick={() => void run("save")}>
            <Save size={15} /> Save draft
          </Button>
          <Button disabled={busy !== null} onClick={() => void run("validate")}>
            <CheckCircle2 size={15} /> Validate
          </Button>
          <Button disabled={busy !== null} onClick={() => void run("preview")}>
            <Play size={15} /> Preview
          </Button>
          <Button
            variant="primary"
            disabled={!canManage || busy !== null}
            onClick={() => void run("publish")}
          >
            <Send size={15} /> Publish
          </Button>
        </div>
      </header>
      {error ? (
        <p className="composer-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="composer-layout">
        <aside className="composer-palette">
          <strong>NODES</strong>
          <p>Add an orchestration step.</p>
          {catalog.map(({ type, label, icon: Icon }) => (
            <button key={type} disabled={!canManage} onClick={() => addNode(type)} type="button">
              <Icon size={15} />
              <span>{label}</span>
              <Plus size={13} />
            </button>
          ))}
          <strong>POLICY</strong>
          <label>
            Service
            <input
              disabled={!canManage}
              value={policy.service ?? ""}
              onChange={(event) => {
                setPolicy({ ...policy, service: event.target.value || undefined });
                setDirty(true);
              }}
            />
          </label>
          <label>
            Source
            <input
              disabled={!canManage}
              value={policy.source ?? ""}
              onChange={(event) => {
                setPolicy({ ...policy, source: event.target.value || undefined });
                setDirty(true);
              }}
            />
          </label>
          <label>
            Country
            <input
              disabled={!canManage}
              value={policy.country ?? ""}
              onChange={(event) => {
                setPolicy({ ...policy, country: event.target.value || undefined });
                setDirty(true);
              }}
            />
          </label>
          <label>
            Lead type
            <input
              disabled={!canManage}
              value={policy.leadType ?? ""}
              onChange={(event) => {
                setPolicy({ ...policy, leadType: event.target.value || undefined });
                setDirty(true);
              }}
            />
          </label>
          <label>
            Priority
            <input
              disabled={!canManage}
              value={policy.priority ?? ""}
              onChange={(event) => {
                setPolicy({ ...policy, priority: event.target.value || undefined });
                setDirty(true);
              }}
            />
          </label>
          <label>
            Manager ID
            <input
              disabled={!canManage}
              value={policy.managerId ?? ""}
              onChange={(event) => {
                setPolicy({ ...policy, managerId: event.target.value || undefined });
                setDirty(true);
              }}
            />
          </label>
          <label>
            Campaign
            <input
              disabled={!canManage}
              value={policy.campaign ?? ""}
              onChange={(event) => {
                setPolicy({ ...policy, campaign: event.target.value || undefined });
                setDirty(true);
              }}
            />
          </label>
          <label>
            Pipeline stage ID
            <input
              disabled={!canManage}
              value={policy.pipelineStageId ?? ""}
              onChange={(event) => {
                setPolicy({ ...policy, pipelineStageId: event.target.value || undefined });
                setDirty(true);
              }}
            />
          </label>
          <label>
            Cadence minutes
            <input
              disabled={!canManage}
              placeholder="60, 1440, 4320"
              value={policy.cadenceMinutes?.join(", ") ?? ""}
              onChange={(event) => {
                const cadenceMinutes = event.target.value
                  .split(",")
                  .map((item) => Number(item.trim()))
                  .filter((item) => Number.isInteger(item) && item > 0);
                setPolicy({
                  ...policy,
                  cadenceMinutes: cadenceMinutes.length ? cadenceMinutes : undefined
                });
                setDirty(true);
              }}
            />
          </label>
        </aside>
        <div
          className="composer-canvas"
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            const id = event.dataTransfer.getData("text/workflow-node");
            const rect = event.currentTarget.getBoundingClientRect();
            if (id) moveNode(id, event.clientX - rect.left - 90, event.clientY - rect.top - 36);
          }}
          style={{ minHeight: canvasHeight }}
        >
          <svg
            className="composer-connectors"
            aria-hidden="true"
            height={canvasHeight}
            width="100%"
          >
            {definition.edges.map((edge) => {
              const source = definition.nodes.find((node) => node.id === edge.source);
              const target = definition.nodes.find((node) => node.id === edge.target);
              if (!source || !target) return null;
              return (
                <path
                  key={edge.id}
                  d={`M ${String(source.position.x + 90)} ${String(source.position.y + 82)} C ${String(source.position.x + 90)} ${String(source.position.y + 115)}, ${String(target.position.x + 90)} ${String(target.position.y - 25)}, ${String(target.position.x + 90)} ${String(target.position.y)}`}
                />
              );
            })}
          </svg>
          {definition.nodes.map((node) => {
            const Icon = catalog.find((item) => item.type === node.type)?.icon ?? CircleDot;
            return (
              <button
                key={node.id}
                className={`composer-node${selectedId === node.id ? " selected" : ""}${invalidIds.has(node.id) ? " invalid" : ""}`}
                data-node-type={node.type}
                draggable={canManage}
                style={{ left: node.position.x, top: node.position.y }}
                onClick={() => setSelectedId(node.id)}
                onDragStart={(event) => event.dataTransfer.setData("text/workflow-node", node.id)}
                type="button"
              >
                <span>
                  <Icon size={14} />
                  {node.type.replaceAll("_", " ")}
                </span>
                <strong>{node.label}</strong>
                <small>{node.id}</small>
              </button>
            );
          })}
        </div>
        <aside className="composer-inspector">
          {preview ? (
            <Preview preview={preview} onClose={() => setPreview(null)} />
          ) : selected ? (
            <>
              <header>
                <div>
                  <span>{selected.type.replaceAll("_", " ")}</span>
                  <h4>Node settings</h4>
                </div>
                <Badge>{selected.id}</Badge>
              </header>
              <label>
                Label
                <input
                  disabled={!canManage}
                  value={selected.label}
                  onChange={(event) => updateNode({ label: event.target.value })}
                />
              </label>
              <NodeFields node={selected} disabled={!canManage} onChange={updateConfig} />
              <label>Next steps</label>
              {outgoing.map((edge, index) => (
                <div className="composer-edge-editor" key={edge.id}>
                  <Select
                    ariaLabel={`Connection ${String(index + 1)} target`}
                    disabled={!canManage}
                    options={nodeOptions}
                    value={edge.target}
                    onChange={(target) =>
                      change({
                        ...definition,
                        edges: definition.edges.map((item) =>
                          item.id === edge.id ? { ...item, target } : item
                        )
                      })
                    }
                  />
                  <input
                    disabled={!canManage}
                    placeholder="Branch"
                    value={edge.branch ?? ""}
                    onChange={(event) =>
                      change({
                        ...definition,
                        edges: definition.edges.map((item) =>
                          item.id === edge.id
                            ? { ...item, branch: event.target.value || null }
                            : item
                        )
                      })
                    }
                  />
                  <Button
                    iconOnly
                    size="sm"
                    title="Remove connection"
                    disabled={!canManage}
                    onClick={() =>
                      change({
                        ...definition,
                        edges: definition.edges.filter((item) => item.id !== edge.id)
                      })
                    }
                  >
                    <Trash2 size={14} />
                  </Button>
                </div>
              ))}
              {nodeOptions.length && selected.type !== "END" ? (
                <Button
                  disabled={!canManage}
                  onClick={() =>
                    change({
                      ...definition,
                      edges: [
                        ...definition.edges,
                        {
                          id: `edge-${Date.now().toString(36)}`,
                          source: selected.id,
                          target: nodeOptions[0]?.value ?? "",
                          branch: selected.type === "CONDITION" ? "true" : null
                        }
                      ]
                    })
                  }
                >
                  <Plus size={14} /> Add connection
                </Button>
              ) : null}
              <div className="inspector-position">
                <label>
                  X
                  <input
                    type="number"
                    disabled={!canManage}
                    value={selected.position.x}
                    onChange={(event) =>
                      updateNode({
                        position: { ...selected.position, x: Number(event.target.value) }
                      })
                    }
                  />
                </label>
                <label>
                  Y
                  <input
                    type="number"
                    disabled={!canManage}
                    value={selected.position.y}
                    onChange={(event) =>
                      updateNode({
                        position: { ...selected.position, y: Number(event.target.value) }
                      })
                    }
                  />
                </label>
              </div>
              <Button
                variant="danger"
                disabled={!canManage || selected.type === "TRIGGER"}
                onClick={() => {
                  change({
                    ...definition,
                    nodes: definition.nodes.filter((node) => node.id !== selected.id),
                    edges: definition.edges.filter(
                      (edge) => edge.source !== selected.id && edge.target !== selected.id
                    )
                  });
                  setSelectedId(definition.nodes[0]?.id ?? "");
                }}
              >
                <Trash2 size={14} /> Delete node
              </Button>
            </>
          ) : (
            <p>Select a node.</p>
          )}
          {validation ? (
            <section className={`composer-validation ${validation.valid ? "valid" : "invalid"}`}>
              <header>
                {validation.valid ? <CheckCircle2 size={16} /> : <XCircle size={16} />}
                <strong>
                  {validation.valid
                    ? "Workflow is valid"
                    : `${String(validation.issues.length)} issue(s)`}
                </strong>
              </header>
              {validation.issues.map((issue, index) => (
                <button
                  key={`${issue.code}-${String(index)}`}
                  onClick={() => issue.nodeId && setSelectedId(issue.nodeId)}
                  type="button"
                >
                  <span>{issue.message}</span>
                  <small>{issue.code.replaceAll("_", " ")}</small>
                </button>
              ))}
            </section>
          ) : null}
        </aside>
      </div>
    </section>
  );
}

function NodeFields({
  node,
  disabled,
  onChange
}: {
  node: WorkflowNodeDto;
  disabled: boolean;
  onChange: (key: string, value: string | number) => void;
}): React.JSX.Element {
  const input = (key: string, label: string) => (
    <label>
      {label}
      <input
        disabled={disabled}
        value={value(node, key)}
        onChange={(event) => onChange(key, event.target.value)}
      />
    </label>
  );
  if (node.type === "TRIGGER") return input("event", "Domain event");
  if (node.type === "CONDITION")
    return (
      <>
        {input("field", "Lead field")}
        {input("value", "Equals")}
      </>
    );
  if (node.type === "WAIT")
    return (
      <>
        <label>
          Duration (minutes)
          <input
            disabled={disabled}
            min="1"
            type="number"
            value={Number(node.config.durationMinutes ?? 60)}
            onChange={(event) => onChange("durationMinutes", Number(event.target.value))}
          />
        </label>
        <label>
          Policy cadence step (optional)
          <input
            disabled={disabled}
            min="0"
            type="number"
            value={typeof node.config.cadenceIndex === "number" ? node.config.cadenceIndex : ""}
            onChange={(event) => onChange("cadenceIndex", Number(event.target.value))}
          />
        </label>
      </>
    );
  if (node.type === "CRM_ACTION")
    return (
      <label>
        Decision
        <Select
          ariaLabel="CRM decision"
          disabled={disabled}
          value={value(node, "action") || "FOLLOW_UP"}
          options={["FOLLOW_UP", "WAIT", "ESCALATE", "STOP", "ASK_HUMAN"].map((item) => ({
            value: item,
            label: item.replaceAll("_", " ")
          }))}
          onChange={(item) => onChange("action", item)}
        />
      </label>
    );
  if (node.type === "TASK")
    return (
      <>
        {input("title", "Task title")}
        <label>
          Due in minutes
          <input
            disabled={disabled}
            min="1"
            type="number"
            value={Number(node.config.dueMinutes ?? 60)}
            onChange={(event) => onChange("dueMinutes", Number(event.target.value))}
          />
        </label>
      </>
    );
  if (node.type === "COMMUNICATION")
    return (
      <>
        <label>
          Channel
          <Select
            ariaLabel="Communication channel"
            disabled={disabled}
            value={value(node, "channel") || "EMAIL"}
            options={["EMAIL", "WHATSAPP", "VOICE"].map((item) => ({ value: item, label: item }))}
            onChange={(item) => onChange("channel", item)}
          />
        </label>
        {value(node, "channel") === "EMAIL" ? (
          <>
            {input("subject", "Email subject")}
            {input("message", "Approved message")}
          </>
        ) : null}
      </>
    );
  if (node.type === "AGENT_INVOKE") return input("agentId", "Existing agent ID");
  if (node.type === "INTEGRATION_ACTION") return input("eventType", "Approved domain event");
  if (node.type === "HUMAN_APPROVAL") return input("reason", "Approval reason");
  return input("outcome", "Outcome");
}
function Preview({
  preview,
  onClose
}: {
  preview: WorkflowPreviewDto;
  onClose: () => void;
}): React.JSX.Element {
  return (
    <div className="composer-preview">
      <header>
        <div>
          <span>SAFE PREVIEW</span>
          <h4>Sandbox trace</h4>
        </div>
        <Badge tone="success">NO LIVE ACTIONS</Badge>
      </header>
      {preview.steps.map((step) => (
        <article key={step.nodeId}>
          <span>{step.order}</span>
          <div>
            <strong>{step.label}</strong>
            <small>{step.outcome}</small>
          </div>
        </article>
      ))}
      <Button onClick={onClose}>Back to inspector</Button>
    </div>
  );
}
