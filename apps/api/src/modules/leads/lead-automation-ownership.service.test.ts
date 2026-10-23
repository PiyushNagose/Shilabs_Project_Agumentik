import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../../shared/prisma.js";
import { updateContact } from "../contacts/contact.service.js";
import {
  completeHumanAction,
  requireHumanAction,
  stopAi
} from "./lead-automation-ownership.service.js";

const marker = "phase-7-5-ownership-test";
const isolationWorkspacePrefix = "phase-7-5-isolation";

async function cleanup(): Promise<void> {
  await prisma.domainEventOutbox.deleteMany({
    where: { idempotencyKey: { startsWith: `${marker}:workflow:` } }
  });
  await prisma.domainEventOutbox.deleteMany({
    where: {
      aggregateType: { in: ["FollowUpAttempt", "CallingAttempt"] },
      payload: { path: ["testMarker"], equals: marker }
    }
  });
  await prisma.callingAttempt.deleteMany({ where: { lead: { source: marker } } });
  await prisma.callingSequence.deleteMany({ where: { lead: { source: marker } } });
  await prisma.followUpAttempt.deleteMany({ where: { lead: { source: marker } } });
  await prisma.followUpSequence.deleteMany({ where: { lead: { source: marker } } });
  await prisma.humanTakeover.deleteMany({ where: { lead: { source: marker } } });
  await prisma.conversation.deleteMany({ where: { lead: { source: marker } } });
  await prisma.activity.deleteMany({ where: { lead: { source: marker } } });
  await prisma.auditEvent.deleteMany({ where: { sourceType: "PHASE_7_5_TEST" } });
  await prisma.workflow.deleteMany({ where: { key: { startsWith: marker } } });
  await prisma.lead.deleteMany({ where: { source: marker } });
  await prisma.contact.deleteMany({ where: { source: marker } });
  await prisma.company.deleteMany({ where: { name: { startsWith: marker } } });
  await prisma.pipelineStage.deleteMany({
    where: { key: { startsWith: isolationWorkspacePrefix } }
  });
  await prisma.pipeline.deleteMany({ where: { name: { startsWith: isolationWorkspacePrefix } } });
  await prisma.workspace.deleteMany({ where: { slug: { startsWith: isolationWorkspacePrefix } } });
}

async function createIsolatedWorkspace(): Promise<string> {
  const suffix = randomUUID();
  const workspace = await prisma.workspace.create({
    data: {
      name: `${isolationWorkspacePrefix}-${suffix}`,
      slug: `${isolationWorkspacePrefix}-${suffix}`
    }
  });
  const pipeline = await prisma.pipeline.create({
    data: {
      workspaceId: workspace.id,
      name: `${isolationWorkspacePrefix}-${suffix}`,
      isDefault: true
    }
  });
  const lastStage = await prisma.pipelineStage.findFirst({ orderBy: { order: "desc" } });
  await prisma.pipelineStage.create({
    data: {
      workspaceId: workspace.id,
      pipelineId: pipeline.id,
      key: `${isolationWorkspacePrefix}-${suffix}`,
      semanticKey: "NEW",
      label: "New",
      order: (lastStage?.order ?? 0) + 1,
      position: 0,
      probability: 10
    }
  });
  return workspace.id;
}

async function seedLead(workspaceId: string) {
  const suffix = randomUUID();
  const stage = await prisma.pipelineStage.findFirstOrThrow({
    where: { workspaceId, status: "ACTIVE", pipeline: { status: "ACTIVE" } }
  });
  const company = await prisma.company.create({
    data: { workspaceId, name: `${marker}-${suffix}` }
  });
  const contact = await prisma.contact.create({
    data: {
      workspaceId,
      companyId: company.id,
      firstName: "Ownership",
      lastName: "Lead",
      source: marker
    }
  });
  return prisma.lead.create({
    data: {
      workspaceId,
      companyId: company.id,
      contactId: contact.id,
      stageId: stage.id,
      source: marker
    }
  });
}

async function seedQueuedWorkflow(lead: Awaited<ReturnType<typeof seedLead>>) {
  if (!lead.workspaceId) throw new Error("Workflow fixture requires a workspace-scoped lead");
  const suffix = randomUUID();
  const workflow = await prisma.workflow.create({
    data: {
      workspaceId: lead.workspaceId,
      key: `${marker}-${suffix}`,
      name: "Ownership isolation workflow",
      description: "Ownership isolation regression fixture"
    }
  });
  const version = await prisma.workflowVersion.create({
    data: {
      workflowId: workflow.id,
      version: 1,
      definition: {
        schemaVersion: 1,
        kind: "WORKFLOW",
        nodes: [
          {
            id: "trigger",
            type: "TRIGGER",
            label: "Lead updated",
            position: { x: 0, y: 0 },
            config: { event: "LEAD_UPDATED" }
          },
          {
            id: "end",
            type: "END",
            label: "Complete",
            position: { x: 0, y: 160 },
            config: { outcome: "COMPLETED" }
          }
        ],
        edges: [{ id: "trigger-end", source: "trigger", target: "end", branch: null }]
      },
      publishedAt: new Date()
    }
  });
  await prisma.workflow.update({
    where: { id: workflow.id },
    data: { status: "PUBLISHED", currentVersionId: version.id }
  });
  const execution = await prisma.workflowExecution.create({
    data: {
      workspaceId: lead.workspaceId,
      workflowId: workflow.id,
      versionId: version.id,
      leadId: lead.id,
      source: "TEST",
      idempotencyKey: `${marker}:workflow:${suffix}`,
      correlationId: suffix
    }
  });
  const event = await prisma.domainEventOutbox.create({
    data: {
      workspaceId: lead.workspaceId,
      eventType: "WORKFLOW_EXECUTION_REQUESTED",
      aggregateType: "WorkflowExecution",
      aggregateId: execution.id,
      payload: { workflowExecutionId: execution.id, leadId: lead.id },
      correlationId: suffix,
      idempotencyKey: `${marker}:workflow:event:${suffix}`
    }
  });
  return { execution, event };
}

describe("Phase 7.5 lead automation ownership", () => {
  beforeEach(async () => cleanup());

  afterAll(async () => {
    await cleanup().catch(() => undefined);
    await prisma.$disconnect();
  });

  it("keeps initial acknowledgement ownership human and activates AI after substantive human work", async () => {
    const workspace = await prisma.workspace.findFirstOrThrow();
    const lead = await seedLead(workspace.id);
    expect(lead.automationOwnershipState).toBe("HUMAN_ACTIVE");

    const result = await completeHumanAction({
      leadId: lead.id,
      reason: "HUMAN_REPLY_SENT",
      actorType: "SYSTEM",
      sourceType: "PHASE_7_5_TEST",
      sourceId: "human-action"
    });

    expect(result.activated).toBe(true);
    await expect(prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).resolves.toMatchObject({
      automationOwnershipState: "AI_ACTIVE",
      automationOwnershipReason: "HUMAN_REPLY_SENT"
    });
    const transitions = await prisma.auditEvent.findMany({
      where: { entityId: lead.id, action: "AUTOMATION_OWNERSHIP_CHANGED" },
      orderBy: { createdAt: "asc" }
    });
    expect(transitions.map((item) => (item.after as { state: string }).state)).toEqual([
      "HUMAN_ACTION_COMPLETED",
      "AI_ACTIVE"
    ]);
  });

  it("stops pending automation on a meaningful reply without touching another workspace", async () => {
    const workspaceA = await prisma.workspace.findFirstOrThrow({ orderBy: { createdAt: "asc" } });
    const workspaceBId = await createIsolatedWorkspace();
    const leadA = await seedLead(workspaceA.id);
    const leadB = await seedLead(workspaceBId);
    await prisma.lead.updateMany({
      where: { id: { in: [leadA.id, leadB.id] } },
      data: { automationOwnershipState: "AI_ACTIVE" }
    });
    const [sequenceA, sequenceB] = await Promise.all(
      [leadA, leadB].map((lead) =>
        prisma.followUpSequence.create({
          data: {
            workspaceId: lead.workspaceId,
            leadId: lead.id,
            contactId: lead.contactId,
            cadenceDays: [2],
            idempotencyKey: `${marker}:${lead.id}`
          }
        })
      )
    );
    if (!sequenceA || !sequenceB) throw new Error("Follow-up sequences were not created");
    const [workflowA, workflowB] = await Promise.all([
      seedQueuedWorkflow(leadA),
      seedQueuedWorkflow(leadB)
    ]);

    await requireHumanAction({
      leadId: leadA.id,
      reason: "MEANINGFUL_CLIENT_REPLY:QUESTION",
      actorType: "SYSTEM",
      sourceType: "PHASE_7_5_TEST",
      sourceId: "reply-a"
    });

    await expect(prisma.lead.findUniqueOrThrow({ where: { id: leadA.id } })).resolves.toMatchObject(
      {
        automationOwnershipState: "HUMAN_REQUIRED",
        nextAction: "Review customer reply and respond"
      }
    );
    const ownershipActivities = await prisma.activity.findMany({
      where: { leadId: leadA.id, type: "AUTOMATION_OWNERSHIP_CHANGED" },
      orderBy: { occurredAt: "asc" }
    });
    expect(
      ownershipActivities.map((activity) => ({
        from: (activity.metadata as { from?: string } | null)?.from,
        to: (activity.metadata as { to?: string } | null)?.to
      }))
    ).toEqual([
      { from: "AI_ACTIVE", to: "AI_STOPPED" },
      { from: "AI_STOPPED", to: "HUMAN_REQUIRED" }
    ]);
    await expect(
      prisma.followUpSequence.findUniqueOrThrow({ where: { id: sequenceA.id } })
    ).resolves.toMatchObject({ status: "STOPPED" });
    await expect(
      prisma.followUpSequence.findUniqueOrThrow({ where: { id: sequenceB.id } })
    ).resolves.toMatchObject({ status: "ACTIVE" });
    await expect(
      prisma.workflowExecution.findUniqueOrThrow({ where: { id: workflowA.execution.id } })
    ).resolves.toMatchObject({
      status: "CANCELED",
      failureCode: "MEANINGFUL_CLIENT_REPLY:QUESTION"
    });
    await expect(
      prisma.domainEventOutbox.findUniqueOrThrow({ where: { id: workflowA.event.id } })
    ).resolves.toMatchObject({
      status: "ATTENTION_REQUIRED",
      lastErrorCode: "MEANINGFUL_CLIENT_REPLY:QUESTION"
    });
    await expect(
      prisma.workflowExecution.findUniqueOrThrow({ where: { id: workflowB.execution.id } })
    ).resolves.toMatchObject({ status: "QUEUED" });
    await expect(
      prisma.domainEventOutbox.findUniqueOrThrow({ where: { id: workflowB.event.id } })
    ).resolves.toMatchObject({ status: "PENDING" });
    await expect(prisma.lead.findUniqueOrThrow({ where: { id: leadB.id } })).resolves.toMatchObject(
      { automationOwnershipState: "AI_ACTIVE" }
    );
  });

  it("keeps a manual pause stopped after later human completion", async () => {
    const workspace = await prisma.workspace.findFirstOrThrow();
    const lead = await seedLead(workspace.id);
    await stopAi({
      leadId: lead.id,
      reason: "MANUAL_PAUSE",
      actorType: "SYSTEM",
      sourceType: "PHASE_7_5_TEST"
    });
    const result = await completeHumanAction({
      leadId: lead.id,
      reason: "LATE_TASK_COMPLETION",
      actorType: "SYSTEM",
      sourceType: "PHASE_7_5_TEST"
    });

    expect(result.activated).toBe(false);
    await expect(prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).resolves.toMatchObject({
      automationOwnershipState: "AI_STOPPED",
      automationOwnershipReason: "MANUAL_PAUSE"
    });
  });

  it("allows only an explicit manual resume to reactivate a paused cycle", async () => {
    const workspace = await prisma.workspace.findFirstOrThrow();
    const lead = await seedLead(workspace.id);
    await stopAi({
      leadId: lead.id,
      reason: "MANUAL_PAUSE",
      actorType: "SYSTEM",
      sourceType: "PHASE_7_5_TEST"
    });

    const result = await completeHumanAction({
      leadId: lead.id,
      reason: "MANUAL_AUTOMATION_RESUME",
      actorType: "SYSTEM",
      sourceType: "PHASE_7_5_TEST",
      allowStoppedResume: true
    });

    expect(result.activated).toBe(true);
    await expect(prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).resolves.toMatchObject({
      automationOwnershipState: "AI_ACTIVE",
      automationOwnershipReason: "MANUAL_AUTOMATION_RESUME"
    });
  });

  it("keeps terminal leads stopped even when an explicit resume is requested", async () => {
    const workspace = await prisma.workspace.findFirstOrThrow();
    const lead = await seedLead(workspace.id);
    await prisma.lead.update({ where: { id: lead.id }, data: { status: "WON" } });

    const result = await completeHumanAction({
      leadId: lead.id,
      reason: "MANUAL_AUTOMATION_RESUME",
      actorType: "SYSTEM",
      sourceType: "PHASE_7_5_TEST",
      allowStoppedResume: true
    });

    expect(result.activated).toBe(false);
    await expect(prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).resolves.toMatchObject({
      automationOwnershipState: "AI_STOPPED",
      automationOwnershipReason: "LEAD_WON"
    });
  });

  it("routes a manual contact DNC change through the shared stop state", async () => {
    const workspace = await prisma.workspace.findFirstOrThrow();
    const user = await prisma.user.findFirstOrThrow({
      where: { status: "ACTIVE", role: { in: ["ADMIN", "SALES_MANAGER"] } }
    });
    const lead = await seedLead(workspace.id);
    await prisma.lead.update({
      where: { id: lead.id },
      data: { automationOwnershipState: "AI_ACTIVE" }
    });
    const sequence = await prisma.followUpSequence.create({
      data: {
        workspaceId: workspace.id,
        leadId: lead.id,
        contactId: lead.contactId,
        cadenceDays: [2],
        idempotencyKey: `${marker}:dnc:${lead.id}`
      }
    });

    await updateContact({ ...user, activeWorkspaceId: workspace.id }, lead.contactId, {
      doNotContact: true
    });

    await expect(prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).resolves.toMatchObject({
      automationOwnershipState: "AI_STOPPED",
      automationOwnershipReason: "DO_NOT_CONTACT"
    });
    await expect(
      prisma.followUpSequence.findUniqueOrThrow({ where: { id: sequence.id } })
    ).resolves.toMatchObject({
      status: "STOPPED",
      stopReason: "DO_NOT_CONTACT"
    });
  });
});
