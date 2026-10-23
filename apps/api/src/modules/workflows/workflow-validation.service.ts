import type { WorkflowPreviewDto, WorkflowValidationDto } from "@shilabs/shared-types";
import type { WorkflowDefinitionInput } from "./workflow.schemas.js";

const sideEffectTypes = new Set([
  "CRM_ACTION",
  "TASK",
  "COMMUNICATION",
  "AGENT_INVOKE",
  "INTEGRATION_ACTION",
  "HUMAN_APPROVAL"
]);
function text(node: WorkflowDefinitionInput["nodes"][number], key: string): string {
  const value = node.config[key];
  return typeof value === "string" ? value.trim() : "";
}
function collectReachableNodes(
  triggerId: string,
  outgoing: Map<string, WorkflowDefinitionInput["edges"]>
): { reached: Set<string>; cyclic: boolean } {
  const reached = new Set<string>();
  const visiting = new Set<string>();
  const visit = (id: string): boolean => {
    if (visiting.has(id)) return true;
    if (reached.has(id)) return false;
    visiting.add(id);
    reached.add(id);
    const cyclic = (outgoing.get(id) ?? []).some((edge) => visit(edge.target));
    visiting.delete(id);
    return cyclic;
  };
  return { reached, cyclic: visit(triggerId) };
}
export function validateWorkflowDefinition(
  definition: WorkflowDefinitionInput
): WorkflowValidationDto {
  const issues: WorkflowValidationDto["issues"] = [];
  const ids = new Set<string>();
  const outgoing = new Map<string, WorkflowDefinitionInput["edges"]>();
  for (const node of definition.nodes) {
    if (ids.has(node.id))
      issues.push({
        code: "DUPLICATE_NODE_ID",
        message: `Node ${node.id} is duplicated.`,
        nodeId: node.id
      });
    ids.add(node.id);
    outgoing.set(node.id, []);
  }
  const edgeIds = new Set<string>();
  for (const edge of definition.edges) {
    if (edgeIds.has(edge.id))
      issues.push({
        code: "DUPLICATE_EDGE_ID",
        message: `Connection ${edge.id} is duplicated.`,
        nodeId: edge.source
      });
    edgeIds.add(edge.id);
    if (!ids.has(edge.source) || !ids.has(edge.target)) {
      issues.push({
        code: "UNKNOWN_EDGE_NODE",
        message: "A connection references a missing node.",
        nodeId: null
      });
      continue;
    }
    if (edge.source === edge.target)
      issues.push({
        code: "SELF_CONNECTION",
        message: "A node cannot connect to itself.",
        nodeId: edge.source
      });
    outgoing.get(edge.source)?.push(edge);
  }
  const triggers = definition.nodes.filter((node) => node.type === "TRIGGER");
  const ends = definition.nodes.filter((node) => node.type === "END");
  if (triggers.length !== 1)
    issues.push({
      code: "TRIGGER_COUNT",
      message: "The workflow must contain exactly one Trigger.",
      nodeId: triggers[0]?.id ?? null
    });
  if (!ends.length)
    issues.push({
      code: "END_REQUIRED",
      message: "The workflow must contain at least one End.",
      nodeId: null
    });
  for (const node of definition.nodes) {
    const next = outgoing.get(node.id) ?? [];
    if (node.type !== "END" && !next.length)
      issues.push({
        code: "MISSING_CONNECTION",
        message: `${node.label} must connect to a next node.`,
        nodeId: node.id
      });
    if (node.type === "END" && next.length)
      issues.push({
        code: "END_HAS_CONNECTION",
        message: "End nodes cannot have outgoing connections.",
        nodeId: node.id
      });
    if (node.type === "CONDITION" && next.length < 2)
      issues.push({
        code: "BRANCH_REQUIRED",
        message: `${node.label} requires at least two branches.`,
        nodeId: node.id
      });
    if (next.length > 1) {
      const branches = next.map((item) => item.branch?.toLowerCase() ?? "");
      if (branches.some((item) => !item) || new Set(branches).size !== branches.length)
        issues.push({
          code: "BRANCH_LABELS",
          message: `${node.label} requires unique branch labels.`,
          nodeId: node.id
        });
    }
    const required =
      node.type === "TRIGGER"
        ? "event"
        : node.type === "CONDITION"
          ? "field"
          : node.type === "TASK"
            ? "title"
            : node.type === "COMMUNICATION"
              ? "channel"
              : node.type === "AGENT_INVOKE"
                ? "agentId"
                : node.type === "INTEGRATION_ACTION"
                  ? "eventType"
                  : node.type === "HUMAN_APPROVAL"
                    ? "reason"
                    : node.type === "CRM_ACTION"
                      ? "action"
                      : null;
    if (required && !text(node, required))
      issues.push({
        code: "CONFIG_REQUIRED",
        message: `${node.label} requires ${required} configuration.`,
        nodeId: node.id
      });
    if (
      node.type === "COMMUNICATION" &&
      text(node, "channel") === "EMAIL" &&
      !text(node, "message")
    )
      issues.push({
        code: "CONFIG_REQUIRED",
        message: `${node.label} requires an approved email message.`,
        nodeId: node.id
      });
    if (
      node.type === "WAIT" &&
      !(
        (typeof node.config.durationMinutes === "number" &&
          Number.isInteger(node.config.durationMinutes) &&
          node.config.durationMinutes >= 1 &&
          node.config.durationMinutes <= 525600) ||
        (typeof node.config.cadenceIndex === "number" &&
          Number.isInteger(node.config.cadenceIndex) &&
          node.config.cadenceIndex >= 0)
      )
    )
      issues.push({
        code: "INVALID_WAIT",
        message: "Wait requires a valid duration or policy cadence step.",
        nodeId: node.id
      });
    if (
      node.type === "CONDITION" &&
      ![
        "source",
        "status",
        "stageId",
        "serviceInterest",
        "ownership",
        "meaningfulReply",
        "requiresHuman"
      ].includes(text(node, "field"))
    )
      issues.push({
        code: "UNSUPPORTED_CONDITION",
        message: `${node.label} must use a field supported by the workflow runtime.`,
        nodeId: node.id
      });
    if (
      node.type === "CRM_ACTION" &&
      !["FOLLOW_UP", "ESCALATE", "STOP", "ASK_HUMAN"].includes(text(node, "action"))
    )
      issues.push({
        code: "UNSUPPORTED_ACTION",
        message: `${node.label} must use an action supported by the workflow runtime.`,
        nodeId: node.id
      });
    if (
      node.type === "INTEGRATION_ACTION" &&
      !["NOTIFICATION_ACKNOWLEDGED", "AGENT_CORRECTION_RECORDED", "REPLY_UNDERSTOOD"].includes(
        text(node, "eventType")
      )
    )
      issues.push({
        code: "UNSUPPORTED_INTEGRATION_ACTION",
        message: `${node.label} must use a connected action supported by the workflow runtime.`,
        nodeId: node.id
      });
  }
  const trigger = triggers[0];
  if (trigger) {
    const { reached, cyclic } = collectReachableNodes(trigger.id, outgoing);
    if (cyclic)
      issues.push({
        code: "CYCLE_NOT_ALLOWED",
        message: "Use Wait nodes for durable repetition; graph cycles are not allowed.",
        nodeId: trigger.id
      });
    for (const node of definition.nodes)
      if (!reached.has(node.id))
        issues.push({
          code: "DISCONNECTED_NODE",
          message: `${node.label} is disconnected from the Trigger.`,
          nodeId: node.id
        });
  }
  return { valid: issues.length === 0, issues };
}

export function previewWorkflowDefinition(definition: WorkflowDefinitionInput): WorkflowPreviewDto {
  const validation = validateWorkflowDefinition(definition);
  if (!validation.valid)
    return { safe: true, mode: "SANDBOX", validation, steps: [], blockedActions: [] };
  const nodes = new Map(definition.nodes.map((node) => [node.id, node]));
  const outgoing = new Map<string, WorkflowDefinitionInput["edges"]>();
  for (const edge of definition.edges)
    outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge]);
  const steps: WorkflowPreviewDto["steps"] = [];
  const blockedActions: string[] = [];
  let current = definition.nodes.find((node) => node.type === "TRIGGER");
  while (current && steps.length <= definition.nodes.length) {
    const blocked = sideEffectTypes.has(current.type);
    steps.push({
      order: steps.length + 1,
      nodeId: current.id,
      nodeType: current.type,
      label: current.label,
      outcome: blocked ? "Simulated; no customer or CRM action executed" : "Validated in sandbox"
    });
    if (blocked) blockedActions.push(current.label);
    const next = (outgoing.get(current.id) ?? [])[0];
    current = next ? nodes.get(next.target) : undefined;
  }
  return { safe: true, mode: "SANDBOX", validation, steps, blockedActions };
}
