import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { workerPrisma } from "../domain-events/domain-event.repository.js";
import {
  triggerWorkflowsForDomainEvent,
  workflowDomainEventHandlers
} from "./workflow-execution.handler.js";

const marker = "phase8-worker";
async function cleanup(): Promise<void> {
  const workspaces = await workerPrisma.workspace.findMany({
    where: { slug: { startsWith: marker } },
    select: { id: true }
  });
  const ids = workspaces.map(({ id }) => id);
  await workerPrisma.domainEventOutbox.deleteMany({ where: { workspaceId: { in: ids } } });
  await workerPrisma.auditEvent.deleteMany({ where: { workspaceId: { in: ids } } });
  await workerPrisma.activity.deleteMany({ where: { workspaceId: { in: ids } } });
  await workerPrisma.task.deleteMany({ where: { workspaceId: { in: ids } } });
  await workerPrisma.integrationAccount.deleteMany({ where: { workspaceId: { in: ids } } });
  await workerPrisma.callingSequence.deleteMany({ where: { workspaceId: { in: ids } } });
  await workerPrisma.followUpSequence.deleteMany({ where: { workspaceId: { in: ids } } });
  await workerPrisma.conversation.deleteMany({ where: { lead: { workspaceId: { in: ids } } } });
  await workerPrisma.agentExecution.deleteMany({ where: { workspaceId: { in: ids } } });
  await workerPrisma.agent.deleteMany({ where: { workspaceId: { in: ids } } });
  await workerPrisma.workflow.deleteMany({ where: { workspaceId: { in: ids } } });
  await workerPrisma.lead.deleteMany({ where: { workspaceId: { in: ids } } });
  await workerPrisma.contact.deleteMany({ where: { workspaceId: { in: ids } } });
  await workerPrisma.company.deleteMany({ where: { workspaceId: { in: ids } } });
  await workerPrisma.pipelineStage.deleteMany({ where: { workspaceId: { in: ids } } });
  await workerPrisma.pipeline.deleteMany({ where: { workspaceId: { in: ids } } });
  await workerPrisma.workspace.deleteMany({ where: { id: { in: ids } } });
}
async function fixture(
  nodes: Prisma.InputJsonArray,
  edges: Prisma.InputJsonArray,
  input?: Prisma.InputJsonObject
) {
  const suffix = randomUUID();
  const workspace = await workerPrisma.workspace.create({
    data: { name: `${marker}-${suffix}`, slug: `${marker}-${suffix}` }
  });
  const pipeline = await workerPrisma.pipeline.create({
    data: { workspaceId: workspace.id, name: `${marker}-${suffix}`, isDefault: true }
  });
  const previous = await workerPrisma.pipelineStage.findFirst({ orderBy: { order: "desc" } });
  const stage = await workerPrisma.pipelineStage.create({
    data: {
      workspaceId: workspace.id,
      pipelineId: pipeline.id,
      key: `${marker}-${suffix}`,
      semanticKey: "NEW",
      label: "New",
      order: (previous?.order ?? 0) + 1,
      probability: 10
    }
  });
  const company = await workerPrisma.company.create({
    data: { workspaceId: workspace.id, name: `${marker}-${suffix}`, location: "India" }
  });
  const contact = await workerPrisma.contact.create({
    data: {
      workspaceId: workspace.id,
      companyId: company.id,
      firstName: "Runtime",
      lastName: "Lead",
      source: marker
    }
  });
  const lead = await workerPrisma.lead.create({
    data: {
      workspaceId: workspace.id,
      companyId: company.id,
      contactId: contact.id,
      stageId: stage.id,
      source: "website",
      serviceInterest: "SEO",
      automationOwnershipState: "AI_ACTIVE"
    }
  });
  const workflow = await workerPrisma.workflow.create({
    data: {
      workspaceId: workspace.id,
      key: `${marker}-${suffix}`,
      name: "Worker workflow",
      description: "Runtime test"
    }
  });
  const version = await workerPrisma.workflowVersion.create({
    data: {
      workflowId: workflow.id,
      version: 1,
      definition: { schemaVersion: 1, kind: "WORKFLOW", nodes, edges },
      policyConfig: { service: "SEO", source: "website", country: "India" },
      publishedAt: new Date()
    }
  });
  await workerPrisma.workflow.update({
    where: { id: workflow.id },
    data: { status: "PUBLISHED", currentVersionId: version.id }
  });
  const execution = await workerPrisma.workflowExecution.create({
    data: {
      workspaceId: workspace.id,
      workflowId: workflow.id,
      versionId: version.id,
      leadId: lead.id,
      source: "TEST",
      idempotencyKey: `${marker}:${suffix}`,
      correlationId: suffix,
      input
    }
  });
  const event = await workerPrisma.domainEventOutbox.create({
    data: {
      workspaceId: workspace.id,
      eventType: "WORKFLOW_EXECUTION_REQUESTED",
      aggregateType: "WorkflowExecution",
      aggregateId: execution.id,
      payload: { workflowExecutionId: execution.id, leadId: lead.id },
      correlationId: suffix,
      idempotencyKey: `${marker}:event:${suffix}`
    }
  });
  return { workspace, lead, execution, event };
}

async function publishedAgent(
  workspaceId: string,
  definition: Prisma.InputJsonObject
): Promise<{ id: string; versionId: string }> {
  const suffix = randomUUID();
  const agent = await workerPrisma.agent.create({
    data: {
      workspaceId,
      key: `${marker}-agent-${suffix}`,
      name: "Runtime agent",
      description: "Published Composer runtime test",
      type: "OUTREACH",
      status: "ACTIVE"
    }
  });
  const version = await workerPrisma.agentVersion.create({
    data: {
      agentId: agent.id,
      version: 1,
      definition,
      publishedAt: new Date()
    }
  });
  await workerPrisma.agent.update({
    where: { id: agent.id },
    data: { currentVersionId: version.id }
  });
  return { id: agent.id, versionId: version.id };
}
describe("Phase 8 workflow runtime", () => {
  it("branches on persisted customer-reply and human-review event context", async () => {
    const data = await fixture(
      [
        {
          id: "trigger",
          type: "TRIGGER",
          label: "Start",
          position: { x: 0, y: 0 },
          config: { event: "CUSTOMER_REPLIED" }
        },
        {
          id: "reply",
          type: "CONDITION",
          label: "Customer replied",
          position: { x: 0, y: 100 },
          config: { field: "meaningfulReply", value: "true" }
        },
        {
          id: "review",
          type: "CONDITION",
          label: "Review required",
          position: { x: 0, y: 200 },
          config: { field: "requiresHuman", value: "true" }
        },
        { id: "yes", type: "END", label: "Escalated", position: { x: 0, y: 300 }, config: {} },
        { id: "no", type: "END", label: "Continue", position: { x: 250, y: 300 }, config: {} }
      ],
      [
        { id: "e1", source: "trigger", target: "reply", branch: null },
        { id: "e2", source: "reply", target: "review", branch: "true" },
        { id: "e3", source: "reply", target: "no", branch: "false" },
        { id: "e4", source: "review", target: "yes", branch: "true" },
        { id: "e5", source: "review", target: "no", branch: "false" }
      ],
      {
        sourceEventType: "CUSTOMER_REPLIED",
        policyContext: { meaningfulReply: true, requiresHumanReview: true }
      }
    );
    const handler = workflowDomainEventHandlers.WORKFLOW_EXECUTION_REQUESTED;
    if (!handler) throw new Error("Handler missing");
    await handler.handle(data.event);

    const steps = await workerPrisma.workflowStepExecution.findMany({
      where: { workflowExecutionId: data.execution.id },
      orderBy: { createdAt: "asc" }
    });
    expect(steps.map((step) => [step.nodeId, step.output])).toEqual(
      expect.arrayContaining([
        ["reply", { branch: "true" }],
        ["review", { branch: "true" }]
      ])
    );
    await expect(
      workerPrisma.workflowExecution.findUniqueOrThrow({ where: { id: data.execution.id } })
    ).resolves.toMatchObject({ status: "SUCCEEDED", currentNodeId: "yes" });
  });

  beforeEach(cleanup);
  afterAll(async () => {
    await cleanup();
    await workerPrisma.$disconnect();
  });
  it("executes idempotent task steps and completes a business-visible timeline", async () => {
    const data = await fixture(
      [
        {
          id: "trigger",
          type: "TRIGGER",
          label: "Lead updated",
          position: { x: 0, y: 0 },
          config: { event: "LEAD_UPDATED" }
        },
        {
          id: "task",
          type: "TASK",
          label: "Follow up",
          position: { x: 0, y: 100 },
          config: { title: "Call the lead", dueMinutes: 30 }
        },
        {
          id: "end",
          type: "END",
          label: "Complete",
          position: { x: 0, y: 200 },
          config: { outcome: "COMPLETED" }
        }
      ],
      [
        { id: "e1", source: "trigger", target: "task", branch: null },
        { id: "e2", source: "task", target: "end", branch: null }
      ]
    );
    const handler = workflowDomainEventHandlers.WORKFLOW_EXECUTION_REQUESTED;
    if (!handler) throw new Error("Handler missing");
    await handler.handle(data.event);
    await handler.handle(data.event);
    await expect(
      workerPrisma.workflowExecution.findUniqueOrThrow({ where: { id: data.execution.id } })
    ).resolves.toMatchObject({ status: "SUCCEEDED" });
    expect(
      await workerPrisma.task.count({
        where: { workspaceId: data.workspace.id, sourceId: data.execution.id }
      })
    ).toBe(1);
    expect(
      await workerPrisma.workflowStepExecution.count({
        where: { workflowExecutionId: data.execution.id }
      })
    ).toBe(3);
    expect(
      await workerPrisma.activity.count({
        where: { leadId: data.lead.id, entityType: "WORKFLOW", visibility: "BUSINESS" }
      })
    ).toBe(1);
  });
  it("queues existing email, WhatsApp, and voice capabilities idempotently", async () => {
    const data = await fixture(
      [
        {
          id: "trigger",
          type: "TRIGGER",
          label: "Lead updated",
          position: { x: 0, y: 0 },
          config: { event: "LEAD_UPDATED" }
        },
        {
          id: "email",
          type: "COMMUNICATION",
          label: "Send email",
          position: { x: 0, y: 100 },
          config: { channel: "EMAIL", subject: "Next step", message: "Can we help further?" }
        },
        {
          id: "whatsapp",
          type: "COMMUNICATION",
          label: "Send WhatsApp",
          position: { x: 0, y: 200 },
          config: { channel: "WHATSAPP" }
        },
        {
          id: "voice",
          type: "COMMUNICATION",
          label: "Place call",
          position: { x: 0, y: 300 },
          config: { channel: "VOICE" }
        },
        { id: "end", type: "END", label: "Done", position: { x: 0, y: 400 }, config: {} }
      ],
      [
        { id: "e1", source: "trigger", target: "email", branch: null },
        { id: "e2", source: "email", target: "whatsapp", branch: null },
        { id: "e3", source: "whatsapp", target: "voice", branch: null },
        { id: "e4", source: "voice", target: "end", branch: null }
      ]
    );
    const handler = workflowDomainEventHandlers.WORKFLOW_EXECUTION_REQUESTED;
    if (!handler) throw new Error("Handler missing");
    await handler.handle(data.event);
    await handler.handle(data.event);
    expect(await workerPrisma.followUpAttempt.count({ where: { leadId: data.lead.id } })).toBe(1);
    expect(await workerPrisma.callingAttempt.count({ where: { leadId: data.lead.id } })).toBe(2);
    const events = await workerPrisma.domainEventOutbox.groupBy({
      by: ["eventType"],
      where: {
        workspaceId: data.workspace.id,
        eventType: {
          in: [
            "FOLLOWUP_EMAIL_SEND_REQUESTED",
            "WHATSAPP_SEND_REQUESTED",
            "CALL_AUTOMATION_ATTEMPT_DUE"
          ]
        }
      },
      _count: true
    });
    expect(Object.fromEntries(events.map((event) => [event.eventType, event._count]))).toEqual({
      CALL_AUTOMATION_ATTEMPT_DUE: 1,
      FOLLOWUP_EMAIL_SEND_REQUESTED: 1,
      WHATSAPP_SEND_REQUESTED: 1
    });
  });

  it("executes the published Composer graph, branches on persisted lead data, and stays idempotent", async () => {
    const data = await fixture(
      [
        {
          id: "trigger",
          type: "TRIGGER",
          label: "Start",
          position: { x: 0, y: 0 },
          config: { event: "LEAD_UPDATED" }
        },
        { id: "end", type: "END", label: "Done", position: { x: 0, y: 100 }, config: {} }
      ],
      [{ id: "e1", source: "trigger", target: "end", branch: null }]
    );
    await workerPrisma.lead.update({ where: { id: data.lead.id }, data: { score: 75 } });
    const agent = await publishedAgent(data.workspace.id, {
      schemaVersion: 1,
      kind: "AGENT_COMPOSER",
      nodes: [
        {
          id: "agent-trigger",
          type: "TRIGGER",
          label: "Workflow request",
          position: { x: 0, y: 0 },
          config: { event: "WORKFLOW" }
        },
        {
          id: "condition",
          type: "CONDITION",
          label: "Qualified score",
          position: { x: 0, y: 100 },
          config: { expression: "lead.score >= 60" }
        },
        {
          id: "task",
          type: "TOOL_CRM_ACTION",
          label: "Review qualified lead",
          position: { x: 0, y: 200 },
          config: { capability: "create-task", title: "Review qualified lead" }
        },
        {
          id: "qualified-end",
          type: "END",
          label: "Qualified",
          position: { x: 0, y: 300 },
          config: { outcome: "Qualified path completed" }
        },
        {
          id: "nurture-end",
          type: "END",
          label: "Nurture",
          position: { x: 250, y: 200 },
          config: { outcome: "Nurture path completed" }
        }
      ],
      edges: [
        { id: "a1", source: "agent-trigger", target: "condition", branch: null },
        { id: "a2", source: "condition", target: "task", branch: "true" },
        { id: "a3", source: "condition", target: "nurture-end", branch: "false" },
        { id: "a4", source: "task", target: "qualified-end", branch: null }
      ]
    });
    await workerPrisma.workflowVersion.update({
      where: { id: data.execution.versionId },
      data: {
        definition: {
          schemaVersion: 1,
          kind: "WORKFLOW",
          nodes: [
            {
              id: "trigger",
              type: "TRIGGER",
              label: "Start",
              position: { x: 0, y: 0 },
              config: { event: "LEAD_UPDATED" }
            },
            {
              id: "agent",
              type: "AGENT_INVOKE",
              label: "Run published agent",
              position: { x: 0, y: 100 },
              config: { agentId: agent.id }
            },
            { id: "end", type: "END", label: "Done", position: { x: 0, y: 200 }, config: {} }
          ],
          edges: [
            { id: "w1", source: "trigger", target: "agent", branch: null },
            { id: "w2", source: "agent", target: "end", branch: null }
          ]
        }
      }
    });

    const handler = workflowDomainEventHandlers.WORKFLOW_EXECUTION_REQUESTED;
    if (!handler) throw new Error("Handler missing");
    await handler.handle(data.event);
    await handler.handle(data.event);

    const execution = await workerPrisma.agentExecution.findFirstOrThrow({
      where: { workspaceId: data.workspace.id, agentId: agent.id }
    });
    expect(execution).toMatchObject({
      versionId: agent.versionId,
      status: "SUCCEEDED",
      summary: "Qualified path completed",
      evaluation: { outcome: "PASSED", reachedEnd: true, traversedNodeCount: 4 }
    });
    const result = execution.result as {
      outcome?: unknown;
      steps?: Record<string, unknown>[];
    };
    expect(result.outcome).toBe("COMPLETED");
    expect(result.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ nodeId: "condition", branch: "true" }),
        expect.objectContaining({ nodeId: "task", outcome: "Task created" })
      ])
    );
    expect(
      await workerPrisma.task.count({
        where: { workspaceId: data.workspace.id, sourceId: execution.id }
      })
    ).toBe(1);
    expect(
      await workerPrisma.agentExecution.count({
        where: { workspaceId: data.workspace.id, agentId: agent.id }
      })
    ).toBe(1);
  });

  it("fails the agent and workflow when a published capability has no safe runtime adapter", async () => {
    const data = await fixture(
      [
        {
          id: "trigger",
          type: "TRIGGER",
          label: "Start",
          position: { x: 0, y: 0 },
          config: { event: "LEAD_UPDATED" }
        },
        { id: "end", type: "END", label: "Done", position: { x: 0, y: 100 }, config: {} }
      ],
      [{ id: "e1", source: "trigger", target: "end", branch: null }]
    );
    const agent = await publishedAgent(data.workspace.id, {
      schemaVersion: 1,
      kind: "AGENT_COMPOSER",
      nodes: [
        {
          id: "agent-trigger",
          type: "TRIGGER",
          label: "Workflow request",
          position: { x: 0, y: 0 },
          config: { event: "WORKFLOW" }
        },
        {
          id: "proposal",
          type: "TOOL_CRM_ACTION",
          label: "Generate proposal",
          position: { x: 0, y: 100 },
          config: { capability: "proposal" }
        },
        { id: "end", type: "END", label: "Done", position: { x: 0, y: 200 }, config: {} }
      ],
      edges: [
        { id: "a1", source: "agent-trigger", target: "proposal", branch: null },
        { id: "a2", source: "proposal", target: "end", branch: null }
      ]
    });
    await workerPrisma.workflowVersion.update({
      where: { id: data.execution.versionId },
      data: {
        definition: {
          schemaVersion: 1,
          kind: "WORKFLOW",
          nodes: [
            {
              id: "trigger",
              type: "TRIGGER",
              label: "Start",
              position: { x: 0, y: 0 },
              config: { event: "LEAD_UPDATED" }
            },
            {
              id: "agent",
              type: "AGENT_INVOKE",
              label: "Run published agent",
              position: { x: 0, y: 100 },
              config: { agentId: agent.id }
            },
            { id: "end", type: "END", label: "Done", position: { x: 0, y: 200 }, config: {} }
          ],
          edges: [
            { id: "w1", source: "trigger", target: "agent", branch: null },
            { id: "w2", source: "agent", target: "end", branch: null }
          ]
        }
      }
    });

    const handler = workflowDomainEventHandlers.WORKFLOW_EXECUTION_REQUESTED;
    if (!handler) throw new Error("Handler missing");
    await expect(handler.handle(data.event)).rejects.toMatchObject({
      code: "AGENT_CAPABILITY_UNAVAILABLE"
    });
    await expect(
      workerPrisma.agentExecution.findFirstOrThrow({
        where: { workspaceId: data.workspace.id, agentId: agent.id }
      })
    ).resolves.toMatchObject({
      status: "FAILED",
      evaluation: {
        outcome: "FAILED",
        code: "AGENT_CAPABILITY_UNAVAILABLE"
      }
    });
    await expect(
      workerPrisma.workflowExecution.findUniqueOrThrow({ where: { id: data.execution.id } })
    ).resolves.toMatchObject({ status: "FAILED" });
  });

  it("persists an agent wait, resumes the same execution, then resumes its parent workflow", async () => {
    const data = await fixture(
      [
        { id: "trigger", type: "TRIGGER", label: "Start", position: { x: 0, y: 0 }, config: {} },
        { id: "end", type: "END", label: "Done", position: { x: 0, y: 100 }, config: {} }
      ],
      [{ id: "e1", source: "trigger", target: "end", branch: null }]
    );
    const agent = await publishedAgent(data.workspace.id, {
      schemaVersion: 1,
      kind: "AGENT_COMPOSER",
      nodes: [
        { id: "start", type: "TRIGGER", label: "Start", position: { x: 0, y: 0 }, config: {} },
        {
          id: "wait",
          type: "WAIT",
          label: "Wait one minute",
          position: { x: 0, y: 100 },
          config: { durationMinutes: 1 }
        },
        {
          id: "end",
          type: "END",
          label: "Finished",
          position: { x: 0, y: 200 },
          config: { outcome: "Resumed safely" }
        }
      ],
      edges: [
        { id: "a1", source: "start", target: "wait", branch: null },
        { id: "a2", source: "wait", target: "end", branch: null }
      ]
    });
    await workerPrisma.workflowVersion.update({
      where: { id: data.execution.versionId },
      data: {
        definition: {
          schemaVersion: 1,
          kind: "WORKFLOW",
          nodes: [
            {
              id: "trigger",
              type: "TRIGGER",
              label: "Start",
              position: { x: 0, y: 0 },
              config: {}
            },
            {
              id: "agent",
              type: "AGENT_INVOKE",
              label: "Run agent",
              position: { x: 0, y: 100 },
              config: { agentId: agent.id }
            },
            { id: "end", type: "END", label: "Done", position: { x: 0, y: 200 }, config: {} }
          ],
          edges: [
            { id: "w1", source: "trigger", target: "agent", branch: null },
            { id: "w2", source: "agent", target: "end", branch: null }
          ]
        }
      }
    });
    const start = workflowDomainEventHandlers.WORKFLOW_EXECUTION_REQUESTED;
    const resumeAgent = workflowDomainEventHandlers.AGENT_EXECUTION_RESUME;
    const resumeWorkflow = workflowDomainEventHandlers.WORKFLOW_EXECUTION_RESUME;
    if (!start || !resumeAgent || !resumeWorkflow) throw new Error("Runtime handler missing");
    await start.handle(data.event);
    const agentExecution = await workerPrisma.agentExecution.findFirstOrThrow({
      where: { workspaceId: data.workspace.id, agentId: agent.id }
    });
    expect(agentExecution).toMatchObject({ status: "WAITING", currentNodeId: "wait" });
    await expect(
      workerPrisma.workflowExecution.findUniqueOrThrow({ where: { id: data.execution.id } })
    ).resolves.toMatchObject({ status: "WAITING", currentNodeId: "agent" });
    expect(
      await workerPrisma.domainEventOutbox.count({
        where: { aggregateId: data.execution.id, eventType: "WORKFLOW_EXECUTION_RESUME" }
      })
    ).toBe(0);

    await workerPrisma.agentExecution.update({
      where: { id: agentExecution.id },
      data: { nextRunAt: new Date(Date.now() - 1_000) }
    });
    const agentResumeEvent = await workerPrisma.domainEventOutbox.findFirstOrThrow({
      where: { aggregateId: agentExecution.id, eventType: "AGENT_EXECUTION_RESUME" }
    });
    await resumeAgent.handle(agentResumeEvent);
    await expect(
      workerPrisma.agentExecution.findUniqueOrThrow({ where: { id: agentExecution.id } })
    ).resolves.toMatchObject({ status: "SUCCEEDED", summary: "Resumed safely" });
    const workflowResumeEvent = await workerPrisma.domainEventOutbox.findFirstOrThrow({
      where: { aggregateId: data.execution.id, eventType: "WORKFLOW_EXECUTION_RESUME" }
    });
    await resumeWorkflow.handle(workflowResumeEvent);
    await resumeWorkflow.handle(workflowResumeEvent);
    await expect(
      workerPrisma.workflowExecution.findUniqueOrThrow({ where: { id: data.execution.id } })
    ).resolves.toMatchObject({ status: "SUCCEEDED" });
    expect(
      await workerPrisma.agentExecution.count({
        where: { workspaceId: data.workspace.id, agentId: agent.id }
      })
    ).toBe(1);
  });

  it("uses a persisted safety decision and applies an idempotent bounded lead update", async () => {
    const data = await fixture(
      [
        { id: "trigger", type: "TRIGGER", label: "Start", position: { x: 0, y: 0 }, config: {} },
        { id: "end", type: "END", label: "Done", position: { x: 0, y: 100 }, config: {} }
      ],
      [{ id: "e1", source: "trigger", target: "end", branch: null }]
    );
    const agent = await publishedAgent(data.workspace.id, {
      schemaVersion: 1,
      kind: "AGENT_COMPOSER",
      nodes: [
        { id: "start", type: "TRIGGER", label: "Start", position: { x: 0, y: 0 }, config: {} },
        {
          id: "decision",
          type: "AI_DECISION",
          label: "Safety decision",
          position: { x: 0, y: 100 },
          config: { instruction: "Use persisted CRM policy", defaultBranch: "approved" }
        },
        {
          id: "update",
          type: "TOOL_CRM_ACTION",
          label: "Warm qualified lead",
          position: { x: 0, y: 200 },
          config: {
            capability: "update-lead",
            score: 72,
            temperature: "WARM",
            nextAction: "Review qualification"
          }
        },
        { id: "review", type: "END", label: "Review", position: { x: 250, y: 200 }, config: {} },
        { id: "end", type: "END", label: "Done", position: { x: 0, y: 300 }, config: {} }
      ],
      edges: [
        { id: "a1", source: "start", target: "decision", branch: null },
        { id: "a2", source: "decision", target: "update", branch: "approved" },
        { id: "a3", source: "decision", target: "review", branch: "human review" },
        { id: "a4", source: "update", target: "end", branch: null }
      ]
    });
    await workerPrisma.workflowVersion.update({
      where: { id: data.execution.versionId },
      data: {
        definition: {
          schemaVersion: 1,
          kind: "WORKFLOW",
          nodes: [
            {
              id: "trigger",
              type: "TRIGGER",
              label: "Start",
              position: { x: 0, y: 0 },
              config: {}
            },
            {
              id: "agent",
              type: "AGENT_INVOKE",
              label: "Agent",
              position: { x: 0, y: 100 },
              config: { agentId: agent.id }
            },
            { id: "end", type: "END", label: "Done", position: { x: 0, y: 200 }, config: {} }
          ],
          edges: [
            { id: "w1", source: "trigger", target: "agent", branch: null },
            { id: "w2", source: "agent", target: "end", branch: null }
          ]
        }
      }
    });
    const handler = workflowDomainEventHandlers.WORKFLOW_EXECUTION_REQUESTED;
    if (!handler) throw new Error("Handler missing");
    await handler.handle(data.event);
    await handler.handle(data.event);
    await expect(
      workerPrisma.lead.findUniqueOrThrow({ where: { id: data.lead.id } })
    ).resolves.toMatchObject({
      score: 72,
      temperature: "WARM",
      nextAction: "Review qualification"
    });
    const execution = await workerPrisma.agentExecution.findFirstOrThrow({
      where: { agentId: agent.id, workspaceId: data.workspace.id }
    });
    const result = execution.result as { steps?: Record<string, unknown>[] };
    expect(result.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          nodeId: "decision",
          branch: "approved",
          outcome: "Persisted safety policy selected approved"
        })
      ])
    );
    expect(
      await workerPrisma.activity.count({
        where: { leadId: data.lead.id, sourceId: `${execution.id}:update:update-lead` }
      })
    ).toBe(1);
  });

  it("creates one human task and moves ownership to HUMAN_REQUIRED", async () => {
    const data = await fixture(
      [
        { id: "trigger", type: "TRIGGER", label: "Start", position: { x: 0, y: 0 }, config: {} },
        { id: "end", type: "END", label: "Done", position: { x: 0, y: 100 }, config: {} }
      ],
      [{ id: "e1", source: "trigger", target: "end", branch: null }]
    );
    const agent = await publishedAgent(data.workspace.id, {
      schemaVersion: 1,
      kind: "AGENT_COMPOSER",
      nodes: [
        { id: "start", type: "TRIGGER", label: "Start", position: { x: 0, y: 0 }, config: {} },
        {
          id: "handoff",
          type: "HUMAN_HANDOFF",
          label: "Manager review",
          position: { x: 0, y: 100 },
          config: { reason: "Pricing approval is required" }
        },
        { id: "end", type: "END", label: "Done", position: { x: 0, y: 200 }, config: {} }
      ],
      edges: [
        { id: "a1", source: "start", target: "handoff", branch: null },
        { id: "a2", source: "handoff", target: "end", branch: null }
      ]
    });
    await workerPrisma.workflowVersion.update({
      where: { id: data.execution.versionId },
      data: {
        definition: {
          schemaVersion: 1,
          kind: "WORKFLOW",
          nodes: [
            {
              id: "trigger",
              type: "TRIGGER",
              label: "Start",
              position: { x: 0, y: 0 },
              config: {}
            },
            {
              id: "agent",
              type: "AGENT_INVOKE",
              label: "Agent",
              position: { x: 0, y: 100 },
              config: { agentId: agent.id }
            },
            { id: "end", type: "END", label: "Done", position: { x: 0, y: 200 }, config: {} }
          ],
          edges: [
            { id: "w1", source: "trigger", target: "agent", branch: null },
            { id: "w2", source: "agent", target: "end", branch: null }
          ]
        }
      }
    });
    const handler = workflowDomainEventHandlers.WORKFLOW_EXECUTION_REQUESTED;
    if (!handler) throw new Error("Handler missing");
    await handler.handle(data.event);
    await handler.handle(data.event);
    const execution = await workerPrisma.agentExecution.findFirstOrThrow({
      where: { agentId: agent.id, workspaceId: data.workspace.id }
    });
    expect(execution).toMatchObject({
      status: "HUMAN_REQUIRED",
      summary: "Pricing approval is required"
    });
    await expect(
      workerPrisma.lead.findUniqueOrThrow({ where: { id: data.lead.id } })
    ).resolves.toMatchObject({
      automationOwnershipState: "HUMAN_REQUIRED",
      automationOwnershipReason: "Pricing approval is required"
    });
    await expect(
      workerPrisma.task.findFirstOrThrow({ where: { sourceId: execution.id } })
    ).resolves.toMatchObject({
      sourceType: "AGENT_EXECUTION",
      createdByType: "AGENT",
      createdByAgentId: agent.id,
      metadata: { nodeId: "handoff", resumeOnCompletion: true }
    });
    await expect(
      workerPrisma.workflowExecution.findUniqueOrThrow({ where: { id: data.execution.id } })
    ).resolves.toMatchObject({ status: "HUMAN_REQUIRED" });
  });
  it("blocks workflow communication when the workspace connection is disabled", async () => {
    const data = await fixture(
      [
        {
          id: "trigger",
          type: "TRIGGER",
          label: "Start",
          position: { x: 0, y: 0 },
          config: { event: "LEAD_UPDATED" }
        },
        {
          id: "email",
          type: "COMMUNICATION",
          label: "Send email",
          position: { x: 0, y: 100 },
          config: { channel: "EMAIL", subject: "Hello", message: "Follow up" }
        },
        { id: "end", type: "END", label: "Done", position: { x: 0, y: 200 }, config: {} }
      ],
      [
        { id: "e1", source: "trigger", target: "email", branch: null },
        { id: "e2", source: "email", target: "end", branch: null }
      ]
    );
    const provider = process.env.EMAIL_PROVIDER === "MAILPIT" ? "MAILPIT" : "AWS_SES";
    await workerPrisma.integrationAccount.create({
      data: {
        workspaceId: data.workspace.id,
        provider,
        key: "default",
        displayName: "Disabled email",
        status: "DISABLED"
      }
    });
    const handler = workflowDomainEventHandlers.WORKFLOW_EXECUTION_REQUESTED;
    if (!handler) throw new Error("Handler missing");
    await expect(handler.handle(data.event)).rejects.toMatchObject({
      code: "INTEGRATION_DISABLED"
    });
    await expect(
      workerPrisma.workflowStepExecution.findFirstOrThrow({
        where: { workflowExecutionId: data.execution.id, nodeId: "email" }
      })
    ).resolves.toMatchObject({ status: "FAILED", failureCode: "INTEGRATION_DISABLED" });
    expect(await workerPrisma.followUpAttempt.count({ where: { leadId: data.lead.id } })).toBe(0);
  });
  it("persists waits and human approval without continuing unsafe automation", async () => {
    const waiting = await fixture(
      [
        {
          id: "trigger",
          type: "TRIGGER",
          label: "Start",
          position: { x: 0, y: 0 },
          config: { event: "LEAD_UPDATED" }
        },
        {
          id: "wait",
          type: "WAIT",
          label: "Wait",
          position: { x: 0, y: 100 },
          config: { cadenceIndex: 0 }
        },
        { id: "end", type: "END", label: "Done", position: { x: 0, y: 200 }, config: {} }
      ],
      [
        { id: "e1", source: "trigger", target: "wait", branch: null },
        { id: "e2", source: "wait", target: "end", branch: null }
      ]
    );
    const handler = workflowDomainEventHandlers.WORKFLOW_EXECUTION_REQUESTED;
    if (!handler) throw new Error("Handler missing");
    await workerPrisma.workflowVersion.update({
      where: { id: waiting.execution.versionId },
      data: { policyConfig: { service: "SEO", source: "website", cadenceMinutes: [5] } }
    });
    await handler.handle(waiting.event);
    await expect(
      workerPrisma.workflowExecution.findUniqueOrThrow({ where: { id: waiting.execution.id } })
    ).resolves.toMatchObject({ status: "WAITING", currentNodeId: "wait" });
    await expect(
      workerPrisma.domainEventOutbox.findFirstOrThrow({
        where: { aggregateId: waiting.execution.id, eventType: "WORKFLOW_EXECUTION_RESUME" }
      })
    ).resolves.toMatchObject({ workspaceId: waiting.workspace.id, status: "PENDING" });
    const human = await fixture(
      [
        {
          id: "trigger",
          type: "TRIGGER",
          label: "Start",
          position: { x: 0, y: 0 },
          config: { event: "LEAD_UPDATED" }
        },
        {
          id: "human",
          type: "HUMAN_APPROVAL",
          label: "Approve",
          position: { x: 0, y: 100 },
          config: { reason: "Approve proposal" }
        },
        { id: "end", type: "END", label: "Done", position: { x: 0, y: 200 }, config: {} }
      ],
      [
        { id: "e1", source: "trigger", target: "human", branch: null },
        { id: "e2", source: "human", target: "end", branch: null }
      ]
    );
    await handler.handle(human.event);
    await expect(
      workerPrisma.workflowExecution.findUniqueOrThrow({ where: { id: human.execution.id } })
    ).resolves.toMatchObject({ status: "HUMAN_REQUIRED" });
    await expect(
      workerPrisma.lead.findUniqueOrThrow({ where: { id: human.lead.id } })
    ).resolves.toMatchObject({
      automationOwnershipState: "HUMAN_REQUIRED",
      automationOwnershipReason: "WORKFLOW_HUMAN_APPROVAL"
    });
    await expect(
      workerPrisma.task.findFirstOrThrow({ where: { sourceId: human.execution.id } })
    ).resolves.toMatchObject({
      sourceType: "WORKFLOW_EXECUTION",
      metadata: { nodeId: "human", resumeOnCompletion: true }
    });
  });

  it("starts a published workflow once from its matching persisted domain event", async () => {
    const data = await fixture(
      [
        {
          id: "trigger",
          type: "TRIGGER",
          label: "Reply understood",
          position: { x: 0, y: 0 },
          config: { event: "REPLY_UNDERSTOOD" }
        },
        {
          id: "end",
          type: "END",
          label: "Done",
          position: { x: 0, y: 100 },
          config: {}
        }
      ],
      [{ id: "e1", source: "trigger", target: "end", branch: null }]
    );
    const source = await workerPrisma.domainEventOutbox.create({
      data: {
        workspaceId: data.workspace.id,
        eventType: "REPLY_UNDERSTOOD",
        aggregateType: "ReplyProcessingRun",
        aggregateId: randomUUID(),
        payload: { leadId: data.lead.id, priority: "HIGH" },
        correlationId: randomUUID(),
        idempotencyKey: `${marker}:source:${randomUUID()}`
      }
    });
    await workerPrisma.workflowVersion.update({
      where: { id: data.execution.versionId },
      data: {
        policyConfig: { service: "SEO", source: "website", country: "India", priority: "HIGH" }
      }
    });
    await triggerWorkflowsForDomainEvent(source);
    await triggerWorkflowsForDomainEvent(source);
    expect(
      await workerPrisma.workflowExecution.count({
        where: { workflowId: data.execution.workflowId, sourceEntityId: source.aggregateId }
      })
    ).toBe(1);
    await expect(
      workerPrisma.domainEventOutbox.findFirstOrThrow({
        where: { aggregateType: "WorkflowExecution", eventType: "WORKFLOW_EXECUTION_REQUESTED" },
        orderBy: { createdAt: "desc" }
      })
    ).resolves.toMatchObject({ workspaceId: data.workspace.id });
    const mismatch = await workerPrisma.domainEventOutbox.create({
      data: {
        workspaceId: data.workspace.id,
        eventType: "REPLY_UNDERSTOOD",
        aggregateType: "ReplyProcessingRun",
        aggregateId: randomUUID(),
        payload: { leadId: data.lead.id, priority: "LOW" },
        correlationId: randomUUID(),
        idempotencyKey: `${marker}:source:${randomUUID()}`
      }
    });
    await triggerWorkflowsForDomainEvent(mismatch);
    expect(
      await workerPrisma.workflowExecution.count({
        where: { workflowId: data.execution.workflowId, sourceEntityId: mismatch.aggregateId }
      })
    ).toBe(0);
  });
});
