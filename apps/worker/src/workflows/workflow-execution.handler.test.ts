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
  await workerPrisma.workflow.deleteMany({ where: { workspaceId: { in: ids } } });
  await workerPrisma.lead.deleteMany({ where: { workspaceId: { in: ids } } });
  await workerPrisma.contact.deleteMany({ where: { workspaceId: { in: ids } } });
  await workerPrisma.company.deleteMany({ where: { workspaceId: { in: ids } } });
  await workerPrisma.pipelineStage.deleteMany({ where: { workspaceId: { in: ids } } });
  await workerPrisma.pipeline.deleteMany({ where: { workspaceId: { in: ids } } });
  await workerPrisma.workspace.deleteMany({ where: { id: { in: ids } } });
}
async function fixture(nodes: Prisma.InputJsonArray, edges: Prisma.InputJsonArray) {
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
      correlationId: suffix
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
describe("Phase 8 workflow runtime", () => {
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
