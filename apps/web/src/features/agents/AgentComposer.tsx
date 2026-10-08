import type React from "react";
import { useMemo, useRef, useState } from "react";
import type {
  AgentComposerDefinitionDto,
  AgentComposerNodeDto,
  AgentComposerNodeType,
  AgentComposerPreviewDto,
  AgentComposerValidationDto,
  AgentDetailDto
} from "@shilabs/shared-types";
import {
  Bot,
  CheckCircle2,
  CircleDot,
  Clock3,
  GitBranch,
  Hand,
  Link2,
  MessageSquare,
  Play,
  Plus,
  Save,
  Send,
  ShieldCheck,
  Sparkles,
  Square,
  Trash2,
  Unplug,
  Wrench,
  XCircle
} from "lucide-react";
import { Badge, Button, Select } from "../../components/ui/index.js";
import {
  previewAgentComposer,
  publishAgentComposer,
  saveAgentComposer,
  validateAgentComposer
} from "../../services/api-client.js";

const nodeCatalog: readonly {
  type: AgentComposerNodeType;
  label: string;
  icon: typeof CircleDot;
}[] = [
  { type: "TRIGGER", label: "Trigger", icon: CircleDot },
  { type: "MESSAGE", label: "Message", icon: MessageSquare },
  { type: "QUESTION", label: "Question", icon: Bot },
  { type: "CONDITION", label: "Condition", icon: GitBranch },
  { type: "AI_DECISION", label: "AI Decision", icon: Sparkles },
  { type: "TOOL_CRM_ACTION", label: "Tool / CRM Action", icon: Wrench },
  { type: "INTEGRATION_ACTION", label: "Integration Action", icon: Link2 },
  { type: "WAIT", label: "Wait", icon: Clock3 },
  { type: "HUMAN_HANDOFF", label: "Human Handoff", icon: Hand },
  { type: "END", label: "End", icon: Square }
];

const capabilityOptions = [
  "outreach",
  "reply-understanding",
  "qualification",
  "proposal",
  "meeting",
  "voice",
  "whatsapp",
  "sales-copilot",
  "create-task",
  "update-lead",
  "assign-owner"
].map((value) => ({ value, label: value.replaceAll("-", " ") }));

function defaultConfig(type: AgentComposerNodeType): AgentComposerNodeDto["config"] {
  if (type === "TRIGGER") return { event: "Lead activity received" };
  if (type === "MESSAGE") return { message: "Thanks for getting in touch. How can I help?" };
  if (type === "QUESTION") return { question: "What outcome would you like to achieve?" };
  if (type === "CONDITION") return { expression: "lead.score >= 60" };
  if (type === "AI_DECISION") return { instruction: "Choose the safest relevant next step." };
  if (type === "TOOL_CRM_ACTION") return { capability: "update-lead" };
  if (type === "INTEGRATION_ACTION") return { capability: "meeting" };
  if (type === "WAIT") return { durationMinutes: 30 };
  if (type === "HUMAN_HANDOFF") return { reason: "Human judgment is required." };
  return { outcome: "Completed" };
}

function defaultDefinition(agent: AgentDetailDto): AgentComposerDefinitionDto {
  const capability = agent.type.toLowerCase().replaceAll("_", "-");
  return {
    schemaVersion: 1,
    kind: "AGENT_COMPOSER",
    nodes: [
      {
        id: "trigger",
        type: "TRIGGER",
        label: "CRM trigger",
        position: { x: 250, y: 36 },
        config: { event: "Relevant CRM event received" }
      },
      {
        id: "decision",
        type: "AI_DECISION",
        label: "Evaluate context",
        position: { x: 250, y: 176 },
        config: {
          instruction: "Evaluate persisted CRM context and choose the safe capability path."
        }
      },
      {
        id: "action",
        type: "TOOL_CRM_ACTION",
        label: agent.name,
        position: { x: 250, y: 316 },
        config: { capability }
      },
      {
        id: "end",
        type: "END",
        label: "Complete",
        position: { x: 250, y: 456 },
        config: { outcome: "Business outcome recorded" }
      }
    ],
    edges: [
      { id: "edge-trigger-decision", source: "trigger", target: "decision", branch: null },
      { id: "edge-decision-action", source: "decision", target: "action", branch: "approved" },
      { id: "edge-decision-end", source: "decision", target: "end", branch: "human review" },
      { id: "edge-action-end", source: "action", target: "end", branch: null }
    ]
  };
}

function composerDefinition(agent: AgentDetailDto): AgentComposerDefinitionDto {
  const raw = agent.draftVersion?.definition ?? agent.currentVersion?.definition;
  if (
    raw &&
    typeof raw === "object" &&
    !Array.isArray(raw) &&
    raw.kind === "AGENT_COMPOSER" &&
    Array.isArray(raw.nodes) &&
    Array.isArray(raw.edges)
  )
    return raw as unknown as AgentComposerDefinitionDto;
  return defaultDefinition(agent);
}

function configField(type: AgentComposerNodeType): { key: string; label: string } | null {
  if (type === "TRIGGER") return { key: "event", label: "Trigger event" };
  if (type === "MESSAGE") return { key: "message", label: "Message" };
  if (type === "QUESTION") return { key: "question", label: "Question" };
  if (type === "CONDITION") return { key: "expression", label: "Condition expression" };
  if (type === "AI_DECISION") return { key: "instruction", label: "Decision instruction" };
  if (type === "HUMAN_HANDOFF") return { key: "reason", label: "Handoff reason" };
  if (type === "END") return { key: "outcome", label: "Outcome" };
  return null;
}

function stringConfig(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

export function AgentComposer({
  accessToken,
  agent,
  canManage,
  onChanged
}: {
  accessToken: string;
  agent: AgentDetailDto;
  canManage: boolean;
  onChanged: () => Promise<void>;
}): React.JSX.Element {
  const [definition, setDefinition] = useState(() => composerDefinition(agent));
  const [selectedId, setSelectedId] = useState(definition.nodes[0]?.id ?? "");
  const [busy, setBusy] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [validation, setValidation] = useState<AgentComposerValidationDto | null>(null);
  const [preview, setPreview] = useState<AgentComposerPreviewDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const selected = definition.nodes.find((node) => node.id === selectedId) ?? null;
  const outgoing = definition.edges.filter((edge) => edge.source === selectedId);
  const canvasHeight = Math.max(650, ...definition.nodes.map((node) => node.position.y + 150));
  const nodeOptions = definition.nodes
    .filter((node) => node.id !== selectedId)
    .map((node) => ({ value: node.id, label: node.label }));
  const issuesByNode = useMemo(
    () => new Set(validation?.issues.map((issue) => issue.nodeId).filter(Boolean) ?? []),
    [validation]
  );

  const change = (next: AgentComposerDefinitionDto): void => {
    setDefinition(next);
    setDirty(true);
    setValidation(null);
    setPreview(null);
    setError(null);
  };
  const updateNode = (id: string, update: Partial<AgentComposerNodeDto>): void =>
    change({
      ...definition,
      nodes: definition.nodes.map((node) => (node.id === id ? { ...node, ...update } : node))
    });
  const updateConfig = (key: string, value: string | number): void => {
    if (!selected) return;
    updateNode(selected.id, { config: { ...selected.config, [key]: value } });
  };
  const addNode = (type: AgentComposerNodeType, label: string): void => {
    const id = `${type.toLowerCase()}-${Date.now().toString(36)}`;
    const node: AgentComposerNodeDto = {
      id,
      type,
      label,
      position: {
        x: 250 + (definition.nodes.length % 2) * 240,
        y: 70 + definition.nodes.length * 105
      },
      config: defaultConfig(type)
    };
    change({ ...definition, nodes: [...definition.nodes, node] });
    setSelectedId(id);
  };
  const removeNode = (): void => {
    if (!selected) return;
    change({
      ...definition,
      nodes: definition.nodes.filter((node) => node.id !== selected.id),
      edges: definition.edges.filter(
        (edge) => edge.source !== selected.id && edge.target !== selected.id
      )
    });
    setSelectedId(definition.nodes.find((node) => node.id !== selected.id)?.id ?? "");
  };
  const addConnection = (): void => {
    if (!selected || nodeOptions.length === 0) return;
    const firstOption = nodeOptions[0];
    if (!firstOption) return;
    const edge = {
      id: `edge-${Date.now().toString(36)}`,
      source: selected.id,
      target: firstOption.value,
      branch: outgoing.length ? `branch ${String(outgoing.length + 1)}` : null
    };
    change({ ...definition, edges: [...definition.edges, edge] });
  };
  const run = async (action: "save" | "validate" | "preview" | "publish"): Promise<void> => {
    setBusy(action);
    setError(null);
    try {
      if (action === "save") {
        await saveAgentComposer(accessToken, agent.id, definition);
        setDirty(false);
      } else if (action === "validate") {
        if (dirty) await saveAgentComposer(accessToken, agent.id, definition);
        setValidation(await validateAgentComposer(accessToken, agent.id));
        setDirty(false);
      } else if (action === "preview") {
        const result = await previewAgentComposer(accessToken, agent.id, definition);
        setPreview(result);
        setValidation(result.validation);
      } else {
        if (dirty) await saveAgentComposer(accessToken, agent.id, definition);
        const checked = await validateAgentComposer(accessToken, agent.id);
        setValidation(checked);
        if (!checked.valid) return;
        await publishAgentComposer(accessToken, agent.id);
        setDirty(false);
      }
      await onChanged();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "The Composer action could not be completed."
      );
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="agent-composer">
      <header className="composer-toolbar">
        <div>
          <span className="records-eyebrow">AGENT / COMPOSER</span>
          <h3>Visual behavior</h3>
          <p>Configure this agent with versioned, reusable platform capabilities.</p>
        </div>
        <div className="composer-toolbar-actions">
          <Badge tone={dirty ? "warning" : agent.draftVersion ? "neutral" : "success"}>
            {dirty ? "UNSAVED" : agent.draftVersion ? "DRAFT SAVED" : "PUBLISHED"}
          </Badge>
          <Button disabled={!canManage || busy !== null} onClick={() => void run("save")}>
            <Save size={15} /> Save
          </Button>
          <Button disabled={busy !== null} onClick={() => void run("validate")}>
            <ShieldCheck size={15} /> Validate
          </Button>
          <Button disabled={busy !== null} onClick={() => void run("preview")}>
            <Play size={15} /> Preview
          </Button>
          <Button
            disabled={!canManage || busy !== null}
            variant="primary"
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
        <aside className="composer-palette" aria-label="Composer nodes">
          <strong>Nodes</strong>
          <p>Add behavior to the canvas.</p>
          {nodeCatalog.map(({ type, label, icon: Icon }) => (
            <button
              disabled={!canManage}
              key={type}
              onClick={() => addNode(type, label)}
              type="button"
            >
              <Icon size={15} /> {label} <Plus size={13} />
            </button>
          ))}
        </aside>
        <div
          className="composer-canvas"
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            const id = event.dataTransfer.getData("text/composer-node");
            const rect = canvasRef.current?.getBoundingClientRect();
            if (!id || !rect) return;
            updateNode(id, {
              position: {
                x: Math.max(12, event.clientX - rect.left - 100),
                y: Math.max(12, event.clientY - rect.top - 35)
              }
            });
          }}
          ref={canvasRef}
          style={{ height: canvasHeight }}
        >
          <svg
            aria-hidden="true"
            className="composer-connectors"
            height={canvasHeight}
            width="100%"
          >
            {definition.edges.map((edge) => {
              const source = definition.nodes.find((node) => node.id === edge.source);
              const target = definition.nodes.find((node) => node.id === edge.target);
              if (!source || !target) return null;
              const sx = source.position.x + 100;
              const sy = source.position.y + 72;
              const tx = target.position.x + 100;
              const ty = target.position.y;
              return (
                <path
                  d={["M", sx, sy, "C", sx, sy + 42, tx, ty - 42, tx, ty].join(" ")}
                  key={edge.id}
                />
              );
            })}
          </svg>
          {definition.nodes.map((node) => {
            const catalog = nodeCatalog.find((item) => item.type === node.type);
            if (!catalog) return null;
            const Icon = catalog.icon;
            return (
              <button
                aria-pressed={selectedId === node.id}
                className={`composer-node${selectedId === node.id ? " selected" : ""}${issuesByNode.has(node.id) ? " invalid" : ""}`}
                draggable={canManage}
                key={node.id}
                onClick={() => setSelectedId(node.id)}
                onDragStart={(event) => event.dataTransfer.setData("text/composer-node", node.id)}
                style={{ left: node.position.x, top: node.position.y }}
                type="button"
              >
                <span>
                  <Icon size={15} /> {catalog.label}
                </span>
                <strong>{node.label}</strong>
                <small>
                  {definition.edges.filter((edge) => edge.source === node.id).length} connection(s)
                </small>
              </button>
            );
          })}
          {definition.nodes.length === 0 ? (
            <div className="composer-empty">
              <Unplug size={24} />
              <strong>Start with a Trigger</strong>
              <span>Add nodes from the palette.</span>
            </div>
          ) : null}
        </div>
        <aside className="composer-inspector">
          {preview ? (
            <PreviewInspector preview={preview} onClose={() => setPreview(null)} />
          ) : selected ? (
            <>
              <header>
                <div>
                  <span>NODE CONFIGURATION</span>
                  <h4>{selected.label}</h4>
                </div>
                <Badge>{selected.type.replaceAll("_", " ")}</Badge>
              </header>
              <label>
                Node label
                <input
                  disabled={!canManage}
                  value={selected.label}
                  onChange={(event) => updateNode(selected.id, { label: event.target.value })}
                />
              </label>
              <NodeConfig node={selected} disabled={!canManage} onChange={updateConfig} />
              <div className="inspector-section">
                <div className="inspector-heading">
                  <strong>Connections</strong>
                  <Button
                    disabled={!canManage || nodeOptions.length === 0 || selected.type === "END"}
                    iconOnly
                    onClick={addConnection}
                    size="sm"
                    title="Add connection"
                  >
                    <Plus size={15} />
                  </Button>
                </div>
                {outgoing.length === 0 ? (
                  <p>No outgoing connections.</p>
                ) : (
                  outgoing.map((edge, index) => (
                    <div className="connection-editor" key={edge.id}>
                      <Select
                        ariaLabel={`Connection ${String(index + 1)} target`}
                        disabled={!canManage}
                        value={edge.target}
                        options={nodeOptions}
                        onChange={(target) =>
                          change({
                            ...definition,
                            edges: definition.edges.map((item) =>
                              item.id === edge.id ? { ...item, target } : item
                            )
                          })
                        }
                      />
                      {outgoing.length > 1 ||
                      selected.type === "CONDITION" ||
                      selected.type === "AI_DECISION" ? (
                        <input
                          aria-label={`Connection ${String(index + 1)} branch`}
                          disabled={!canManage}
                          placeholder="Branch label"
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
                      ) : null}
                      <Button
                        disabled={!canManage}
                        iconOnly
                        onClick={() =>
                          change({
                            ...definition,
                            edges: definition.edges.filter((item) => item.id !== edge.id)
                          })
                        }
                        size="sm"
                        title="Remove connection"
                      >
                        <Trash2 size={14} />
                      </Button>
                    </div>
                  ))
                )}
              </div>
              <div className="inspector-position">
                <label>
                  X
                  <input
                    disabled={!canManage}
                    min="0"
                    type="number"
                    value={selected.position.x}
                    onChange={(event) =>
                      updateNode(selected.id, {
                        position: { ...selected.position, x: Number(event.target.value) }
                      })
                    }
                  />
                </label>
                <label>
                  Y
                  <input
                    disabled={!canManage}
                    min="0"
                    type="number"
                    value={selected.position.y}
                    onChange={(event) =>
                      updateNode(selected.id, {
                        position: { ...selected.position, y: Number(event.target.value) }
                      })
                    }
                  />
                </label>
              </div>
              <Button disabled={!canManage} variant="danger" onClick={removeNode}>
                <Trash2 size={15} /> Delete node
              </Button>
            </>
          ) : (
            <div className="composer-empty">
              <CircleDot size={22} />
              <strong>Select a node</strong>
              <span>Configuration appears here.</span>
            </div>
          )}
          {validation ? (
            <ValidationSummary validation={validation} onSelect={setSelectedId} />
          ) : null}
        </aside>
      </div>
    </section>
  );
}

function NodeConfig({
  node,
  disabled,
  onChange
}: {
  node: AgentComposerNodeDto;
  disabled: boolean;
  onChange: (key: string, value: string | number) => void;
}): React.JSX.Element {
  const field = configField(node.type);
  if (node.type === "TOOL_CRM_ACTION" || node.type === "INTEGRATION_ACTION")
    return (
      <label>
        Existing capability
        <Select
          ariaLabel="Existing capability"
          disabled={disabled}
          options={capabilityOptions}
          value={stringConfig(node.config.capability, capabilityOptions[0]?.value ?? "outreach")}
          onChange={(value) => onChange("capability", value)}
        />
      </label>
    );
  if (node.type === "WAIT")
    return (
      <label>
        Duration in minutes
        <input
          disabled={disabled}
          max="10080"
          min="1"
          type="number"
          value={Number(node.config.durationMinutes ?? 30)}
          onChange={(event) => onChange("durationMinutes", Number(event.target.value))}
        />
      </label>
    );
  if (!field) return <></>;
  const value = stringConfig(node.config[field.key]);
  return (
    <label>
      {field.label}
      {["MESSAGE", "QUESTION", "AI_DECISION", "HUMAN_HANDOFF"].includes(node.type) ? (
        <textarea
          disabled={disabled}
          rows={4}
          value={value}
          onChange={(event) => onChange(field.key, event.target.value)}
        />
      ) : (
        <input
          disabled={disabled}
          value={value}
          onChange={(event) => onChange(field.key, event.target.value)}
        />
      )}
    </label>
  );
}

function ValidationSummary({
  validation,
  onSelect
}: {
  validation: AgentComposerValidationDto;
  onSelect: (id: string) => void;
}): React.JSX.Element {
  return (
    <section className={`composer-validation ${validation.valid ? "valid" : "invalid"}`}>
      <header>
        {validation.valid ? <CheckCircle2 size={17} /> : <XCircle size={17} />}
        <strong>
          {validation.valid
            ? "Flow is valid"
            : `${String(validation.issues.length)} issue(s) found`}
        </strong>
      </header>
      {validation.issues.map((issue, index) => (
        <button
          key={`${issue.code}-${String(index)}`}
          onClick={() => issue.nodeId && onSelect(issue.nodeId)}
          type="button"
        >
          <span>{issue.message}</span>
          <small>{issue.code.replaceAll("_", " ")}</small>
        </button>
      ))}
    </section>
  );
}

function PreviewInspector({
  preview,
  onClose
}: {
  preview: AgentComposerPreviewDto;
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
      {preview.blockedActions.length ? (
        <p>
          <ShieldCheck size={15} /> Blocked live actions: {preview.blockedActions.join(", ")}
        </p>
      ) : null}
      <Button onClick={onClose}>Back to inspector</Button>
    </div>
  );
}
