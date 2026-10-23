import { randomUUID } from "node:crypto";
import request from "supertest";
import { UserRole, UserStatus } from "@prisma/client";
import type {
  AiCommandCenterDto,
  AuthResponse,
  LeadDocumentDto,
  LeadIntelligenceDecisionDto,
  LeadIntelligenceDto
} from "@shilabs/shared-types";
import { createApp } from "../../app.js";
import { prisma } from "../../shared/prisma.js";
import { hashPassword } from "../auth/auth.service.js";

const app = createApp();
const marker = `phase10-${randomUUID()}`;
const stageKey = `PHASE10_${randomUUID().replaceAll("-", "_")}`;

async function identity(label: string, role: UserRole = UserRole.ADMIN) {
  const user = await prisma.user.create({
    data: {
      email: `${marker}-${label}@example.local`,
      passwordHash: await hashPassword("CorrectHorse123!"),
      firstName: label,
      lastName: "Phase10",
      role,
      status: UserStatus.ACTIVE
    }
  });
  const workspace = await prisma.workspace.create({
    data: { name: `${marker}-${label}`, slug: `${marker}-${label}` }
  });
  await prisma.workspaceMember.create({
    data: {
      workspaceId: workspace.id,
      userId: user.id,
      role:
        role === UserRole.SALES_REP
          ? "SALES_REP"
          : role === UserRole.SALES_MANAGER
            ? "SALES_MANAGER"
            : "ADMIN",
      status: "ACTIVE"
    }
  });
  const login = await request(app)
    .post("/api/auth/login")
    .send({ email: user.email, password: "CorrectHorse123!" })
    .expect(200);
  return { user, workspace, token: (login.body as AuthResponse).accessToken };
}

async function leadFor(identityRecord: Awaited<ReturnType<typeof identity>>, label: string) {
  const stage = await prisma.pipelineStage.upsert({
    where: { key: stageKey },
    update: {},
    create: { key: stageKey, label: "Phase 10 New", order: 9700, probability: 20 }
  });
  const company = await prisma.company.create({
    data: {
      workspaceId: identityRecord.workspace.id,
      name: `${marker}-${label}-company`,
      industry: "Technology"
    }
  });
  const contact = await prisma.contact.create({
    data: {
      workspaceId: identityRecord.workspace.id,
      companyId: company.id,
      firstName: label,
      lastName: "Prospect",
      email: `${marker}-${label}@customer.local`,
      source: marker
    }
  });
  return prisma.lead.create({
    data: {
      workspaceId: identityRecord.workspace.id,
      companyId: company.id,
      contactId: contact.id,
      ownerId: identityRecord.user.id,
      source: marker,
      stageId: stage.id,
      requirement: "Improve organic acquisition",
      serviceInterest: "SEO audit",
      score: 82,
      temperature: "HOT",
      automationOwnershipState: "AI_ACTIVE",
      estimatedValue: "12000",
      currency: "USD"
    }
  });
}

function api(
  method: "get" | "post" | "patch" | "delete",
  path: string,
  token: string,
  workspaceId: string
) {
  const client = request(app);
  return client[method](path)
    .set("Authorization", `Bearer ${token}`)
    .set("x-workspace-id", workspaceId);
}

async function scheduledFollowUps(
  manager: Awaited<ReturnType<typeof identity>>,
  lead: Awaited<ReturnType<typeof leadFor>>,
  sentFirst = true
) {
  const createdAt = new Date(Date.now() - 2 * 86_400_000);
  const policy = await prisma.followUpPolicy.create({
    data: {
      workspaceId: manager.workspace.id,
      name: lead.id,
      cadenceDays: [0, 1, 5, 9]
    }
  });
  const sequence = await prisma.followUpSequence.create({
    data: {
      workspaceId: manager.workspace.id,
      leadId: lead.id,
      contactId: lead.contactId,
      policyId: policy.id,
      cadenceDays: [1, 5, 9],
      cadenceOffsetsMinutes: [1440, 7200, 12960],
      createdAt,
      idempotencyKey: `${marker}-scheduled-${lead.id}`,
      attempts: {
        create: [1, 5, 9].map((day, stepIndex) => ({
          leadId: lead.id,
          stepIndex,
          kind: stepIndex === 0 ? "FIRST_EMAIL" : "FOLLOW_UP",
          status: sentFirst && stepIndex === 0 ? "SENT" : "SCHEDULED",
          scheduledAt: new Date(createdAt.getTime() + day * 86_400_000),
          sentAt:
            sentFirst && stepIndex === 0 ? new Date(createdAt.getTime() + day * 86_400_000) : null,
          subject: "Follow-up on SEO",
          textBody: "Grounded draft",
          idempotencyKey: `${marker}-${lead.id}-${String(stepIndex)}`
        }))
      }
    },
    include: { attempts: { orderBy: { stepIndex: "asc" } } }
  });
  for (const attempt of sequence.attempts) {
    const event = await prisma.domainEventOutbox.create({
      data: {
        workspaceId: manager.workspace.id,
        eventType: "FOLLOWUP_EMAIL_SEND_REQUESTED",
        aggregateType: "FollowUpAttempt",
        aggregateId: attempt.id,
        correlationId: sequence.id,
        idempotencyKey: `${marker}-event-${attempt.id}`,
        status: attempt.status === "SENT" ? "PROCESSED" : "PENDING",
        nextAttemptAt: attempt.scheduledAt,
        payload: { leadId: lead.id, followUpAttemptId: attempt.id, followUpSequenceId: sequence.id }
      }
    });
    Object.assign(
      attempt,
      await prisma.followUpAttempt.update({
        where: { id: attempt.id },
        data: { domainEventId: event.id }
      })
    );
  }
  return sequence;
}

describe("Phase 10 lead intelligence API", () => {
  afterAll(async () => {
    const workspaces = await prisma.workspace.findMany({
      where: { slug: { startsWith: marker } },
      select: { id: true }
    });
    const workspaceIds = workspaces.map(({ id }) => id);
    const users = await prisma.user.findMany({
      where: { email: { startsWith: marker } },
      select: { id: true }
    });
    const userIds = users.map(({ id }) => id);
    await prisma.domainEventOutbox.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    await prisma.auditEvent.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    await prisma.activity.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    await prisma.leadIntelligenceDecision.deleteMany({
      where: { workspaceId: { in: workspaceIds } }
    });
    await prisma.leadDocument.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    await prisma.leadIntelligence.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    await prisma.replyProcessingRun.deleteMany({
      where: { lead: { workspaceId: { in: workspaceIds } } }
    });
    await prisma.inboundEmail.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    await prisma.message.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    await prisma.task.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    await prisma.deal.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    await prisma.followUpAttempt.deleteMany({
      where: { lead: { workspaceId: { in: workspaceIds } } }
    });
    await prisma.followUpSequence.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    await prisma.meetingRequest.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    await prisma.conversation.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    await prisma.lead.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    await prisma.contact.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    await prisma.company.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    await prisma.authSession.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.workspaceMember.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    await prisma.workspace.deleteMany({ where: { id: { in: workspaceIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.pipelineStage.deleteMany({ where: { key: stageKey } });
    await prisma.$disconnect();
  }, 45000);

  it("indexes exact document evidence and never invents document findings", async () => {
    const admin = await identity("grounding");
    const lead = await leadFor(admin, "Grounded");
    const document = (
      await api(
        "post",
        `/api/lead-intelligence/leads/${lead.id}/documents`,
        admin.token,
        admin.workspace.id
      )
        .send({
          title: "Organic visibility audit",
          kind: "AUDIT",
          sourceType: "UPLOAD",
          mimeType: "text/plain",
          content:
            "Organic traffic declined 32% over six months. Commercial keyword visibility is the primary concern."
        })
        .expect(201)
    ).body as LeadDocumentDto;
    expect(document.status).toBe("INDEXED");
    expect(document.chunkCount).toBe(1);

    const intelligence = (
      await api(
        "get",
        `/api/lead-intelligence/leads/${lead.id}`,
        admin.token,
        admin.workspace.id
      ).expect(200)
    ).body as LeadIntelligenceDto;
    expect(intelligence.summary).toContain("Improve organic acquisition");
    expect(
      intelligence.evidence.some(
        (item) => item.sourceId.startsWith("document-chunk:") && item.quote.includes("declined 32%")
      )
    ).toBe(true);
    expect(intelligence.evidence.every((item) => item.quote.length > 0)).toBe(true);
  });

  it("extracts and indexes an uploaded text document without storing the file", async () => {
    const manager = await identity("upload", UserRole.SALES_MANAGER);
    const lead = await leadFor(manager, "Upload");
    const document = (
      await api(
        "post",
        `/api/lead-intelligence/leads/${lead.id}/documents/upload`,
        manager.token,
        manager.workspace.id
      )
        .field("title", "Approved discovery notes")
        .field("kind", "REPORT")
        .attach(
          "file",
          Buffer.from(
            "Approved discovery finding: the customer needs a consolidated sales dashboard.\n\nDeployment is planned for Q1."
          ),
          { filename: "discovery-notes.txt", contentType: "text/plain" }
        )
        .expect(201)
    ).body as LeadDocumentDto;

    expect(document).toMatchObject({
      title: "Approved discovery notes",
      kind: "REPORT",
      sourceType: "UPLOAD",
      mimeType: "text/plain",
      status: "INDEXED",
      chunkCount: 1
    });
    expect(document.extractedText).toContain("consolidated sales dashboard");
    const persisted = await prisma.leadDocument.findUniqueOrThrow({
      where: { id: document.id },
      include: { chunks: { orderBy: { position: "asc" } } }
    });
    expect(persisted.sourceUrl).toBeNull();
    expect(persisted.extractedText).toBe(document.extractedText);
    expect(persisted.chunks.map((chunk) => chunk.content).join("")).toBe(document.extractedText);
    expect(persisted.chunks.every((chunk) => chunk.content.length <= 1200)).toBe(true);
  });

  it("rejects unsafe uploads before persistence and enforces upload RBAC", async () => {
    const admin = await identity("upload-guard");
    const rep = await identity("upload-rep", UserRole.SALES_REP);
    const lead = await leadFor(admin, "Upload guard");
    const uploadPath = `/api/lead-intelligence/leads/${lead.id}/documents/upload`;

    const unsupported = await api("post", uploadPath, admin.token, admin.workspace.id)
      .field("title", "Executable")
      .field("kind", "OTHER")
      .attach("file", Buffer.from("not executable"), {
        filename: "payload.exe",
        contentType: "application/octet-stream"
      })
      .expect(400);
    expect((unsupported.body as { error: { message: string } }).error.message).toBe(
      "Only PDF, DOCX, and TXT documents are supported"
    );

    const empty = await api("post", uploadPath, admin.token, admin.workspace.id)
      .field("title", "Empty notes")
      .field("kind", "OTHER")
      .attach("file", Buffer.from("   \n\n"), {
        filename: "empty.txt",
        contentType: "text/plain"
      })
      .expect(400);
    expect((empty.body as { error: { message: string } }).error.message).toContain(
      "No readable text"
    );

    await api("post", uploadPath, rep.token, rep.workspace.id)
      .field("title", "Forbidden")
      .field("kind", "REPORT")
      .attach("file", Buffer.from("This content must not be indexed."), {
        filename: "forbidden.txt",
        contentType: "text/plain"
      })
      .expect(403);

    expect(await prisma.leadDocument.count({ where: { leadId: lead.id } })).toBe(0);
  });

  it("escalates high-risk client language and blocks cross-workspace reads", async () => {
    const manager = await identity("manager", UserRole.SALES_MANAGER);
    const other = await identity("other");
    const lead = await leadFor(manager, "Risk");
    const conversation = await prisma.conversation.create({
      data: {
        workspaceId: manager.workspace.id,
        leadId: lead.id,
        channel: "EMAIL",
        mode: "AUTO"
      }
    });
    await prisma.message.create({
      data: {
        workspaceId: manager.workspace.id,
        conversationId: conversation.id,
        direction: "INBOUND",
        senderType: "PROSPECT",
        body: "Your pricing is too high. I need a discount and legal contract changes."
      }
    });

    const decision = (
      await api(
        "post",
        `/api/lead-intelligence/leads/${lead.id}/decisions`,
        manager.token,
        manager.workspace.id
      )
        .send({})
        .expect(201)
    ).body as LeadIntelligenceDecisionDto;
    expect(decision.decision).toBe("ESCALATE");
    expect(decision.guardrailCode).toBe("HIGH_RISK_CLIENT_CONTEXT");
    expect(decision.evidence[0]?.quote).toContain("pricing is too high");
    await expect(
      prisma.lead
        .findUniqueOrThrow({ where: { id: lead.id } })
        .then((item) => item.automationOwnershipState)
    ).resolves.toBe("HUMAN_REQUIRED");
    await api(
      "get",
      `/api/lead-intelligence/leads/${lead.id}`,
      other.token,
      other.workspace.id
    ).expect(404);
  });

  it("does not reopen a high-risk request after a substantive human response", async () => {
    const manager = await identity("resolved-risk", UserRole.SALES_MANAGER);
    const lead = await leadFor(manager, "Resolved Risk");
    const conversation = await prisma.conversation.create({
      data: {
        workspaceId: manager.workspace.id,
        leadId: lead.id,
        channel: "EMAIL",
        mode: "AUTO"
      }
    });
    await prisma.message.createMany({
      data: [
        {
          workspaceId: manager.workspace.id,
          conversationId: conversation.id,
          direction: "INBOUND",
          senderType: "PROSPECT",
          body: "Please approve a discount and custom legal terms.",
          createdAt: new Date("2026-10-15T10:00:00.000Z")
        },
        {
          workspaceId: manager.workspace.id,
          conversationId: conversation.id,
          direction: "OUTBOUND",
          senderType: "USER",
          body: "I cannot approve a discount or legal terms here. Both require written approval.",
          createdAt: new Date("2026-10-15T10:05:00.000Z")
        }
      ]
    });

    const decision = (
      await api(
        "post",
        `/api/lead-intelligence/leads/${lead.id}/decisions`,
        manager.token,
        manager.workspace.id
      )
        .send({})
        .expect(201)
    ).body as LeadIntelligenceDecisionDto;
    expect(decision.decision).not.toBe("ESCALATE");
    await expect(
      prisma.lead
        .findUniqueOrThrow({ where: { id: lead.id } })
        .then((item) => item.automationOwnershipState)
    ).resolves.not.toBe("HUMAN_REQUIRED");
  });

  it("enforces manager controls and stops pending AI ownership when paused", async () => {
    const manager = await identity("controls", UserRole.SALES_MANAGER);
    const rep = await identity("rep", UserRole.SALES_REP);
    const lead = await leadFor(manager, "Controls");
    await api(
      "patch",
      `/api/lead-intelligence/leads/${lead.id}/controls`,
      rep.token,
      rep.workspace.id
    )
      .send({ aiControlStatus: "PAUSED" })
      .expect(403);
    const updated = (
      await api(
        "patch",
        `/api/lead-intelligence/leads/${lead.id}/controls`,
        manager.token,
        manager.workspace.id
      )
        .send({ aiControlStatus: "PAUSED", followUpMode: "HIGH_VALUE", preferredChannel: "MIXED" })
        .expect(200)
    ).body as LeadIntelligenceDto;
    expect(updated.aiControlStatus).toBe("PAUSED");
    expect(updated.followUpMode).toBe("HIGH_VALUE");
    await expect(
      prisma.lead
        .findUniqueOrThrow({ where: { id: lead.id } })
        .then((item) => item.automationOwnershipState)
    ).resolves.toBe("AI_STOPPED");
    expect(
      await prisma.auditEvent.count({
        where: { workspaceId: manager.workspace.id, action: "LEAD_AI_CONTROLS_UPDATED" }
      })
    ).toBe(1);
  });

  it("reschedules queued unsent attempts and the next-action task without changing sent history", async () => {
    const manager = await identity("reschedule", UserRole.SALES_MANAGER);
    const lead = await leadFor(manager, "Reschedule");
    const sequence = await scheduledFollowUps(manager, lead);
    const sent = sequence.attempts[0];
    const pending = sequence.attempts[1];
    if (!sent || !pending?.domainEventId) throw new Error("Missing schedule fixture");
    await prisma.domainEventOutbox.update({
      where: { id: pending.domainEventId },
      data: {
        status: "QUEUED",
        queueJobId: "stale-queued-job",
        queueName: "domain-events",
        queuedAt: new Date()
      }
    });
    await api(
      "patch",
      `/api/lead-intelligence/leads/${lead.id}/controls`,
      manager.token,
      manager.workspace.id
    )
      .send({ followUpMode: "LOW_FREQUENCY" })
      .expect(200);
    expect(await prisma.followUpAttempt.findUnique({ where: { id: sent.id } })).toEqual(sent);
    const dueAt = new Date(sequence.createdAt.getTime() + 14 * 86_400_000);
    expect(await prisma.followUpAttempt.findUnique({ where: { id: pending.id } })).toMatchObject({
      scheduledAt: dueAt
    });
    expect(
      await prisma.domainEventOutbox.findUnique({ where: { id: pending.domainEventId } })
    ).toMatchObject({
      status: "PENDING",
      nextAttemptAt: dueAt,
      queueJobId: null
    });
    expect(await prisma.lead.findUnique({ where: { id: lead.id } })).toMatchObject({
      nextActionAt: dueAt
    });
    expect(
      await prisma.task.findUnique({ where: { projectionKey: `lead:${lead.id}:next-action` } })
    ).toMatchObject({ dueAt, status: "OPEN" });
    expect(await prisma.followUpSequence.findUnique({ where: { id: sequence.id } })).toMatchObject({
      cadenceDays: [1, 14, 21]
    });
  });

  it("extends and shortens a custom cadence while preserving sent attempt identities", async () => {
    const manager = await identity("custom-cadence");
    const lead = await leadFor(manager, "Custom");
    const sequence = await scheduledFollowUps(manager, lead);
    const controls = `/api/lead-intelligence/leads/${lead.id}/controls`;
    await api("patch", controls, manager.token, manager.workspace.id)
      .send({ followUpMode: "CUSTOM", customCadenceDays: [2, 6, 10, 15] })
      .expect(200);
    expect(
      await prisma.followUpAttempt.count({
        where: { sequenceId: sequence.id, status: "SCHEDULED" }
      })
    ).toBe(3);
    await api("patch", controls, manager.token, manager.workspace.id)
      .send({ customCadenceDays: [2, 6] })
      .expect(200);
    expect(
      await prisma.followUpAttempt.count({
        where: { sequenceId: sequence.id, status: "SCHEDULED" }
      })
    ).toBe(1);
    expect(
      await prisma.followUpAttempt.count({
        where: { sequenceId: sequence.id, status: "CANCELLED" }
      })
    ).toBe(2);
    await api("patch", controls, manager.token, manager.workspace.id)
      .send({ customCadenceDays: [2, 6, 12] })
      .expect(200);
    expect(
      await prisma.followUpAttempt.count({
        where: { sequenceId: sequence.id, status: "SCHEDULED" }
      })
    ).toBe(2);
    const sent = sequence.attempts[0];
    expect(await prisma.followUpAttempt.findUnique({ where: { id: sent?.id } })).toEqual(sent);
    await api("patch", controls, manager.token, manager.workspace.id)
      .send({ customCadenceDays: [] })
      .expect(400);
  });

  it("rolls back control changes when a scheduled event is already processing", async () => {
    const manager = await identity("busy-cadence");
    const lead = await leadFor(manager, "Busy");
    const sequence = await scheduledFollowUps(manager, lead);
    const attempt = sequence.attempts[1];
    if (!attempt?.domainEventId) throw new Error("Missing pending fixture");
    await prisma.domainEventOutbox.update({
      where: { id: attempt.domainEventId },
      data: { status: "PROCESSING" }
    });
    await api(
      "patch",
      `/api/lead-intelligence/leads/${lead.id}/controls`,
      manager.token,
      manager.workspace.id
    )
      .send({ followUpMode: "LOW_FREQUENCY" })
      .expect(409);
    expect(await prisma.leadIntelligence.findUnique({ where: { leadId: lead.id } })).toMatchObject({
      followUpMode: "STANDARD"
    });
    expect(await prisma.followUpAttempt.findUnique({ where: { id: attempt.id } })).toEqual(attempt);
  });

  it("decides from persisted dates, honors promised dates, and ignores automatic disclaimers", async () => {
    const manager = await identity("schedule-decision");
    const lead = await leadFor(manager, "Decision");
    const sequence = await scheduledFollowUps(manager, lead);
    const tomorrow = new Date(Date.now() + 86_400_000);
    await prisma.followUpAttempt.updateMany({
      where: { sequenceId: sequence.id, status: "SCHEDULED" },
      data: { scheduledAt: tomorrow }
    });
    const conversation = await prisma.conversation.create({
      data: { workspaceId: manager.workspace.id, leadId: lead.id, channel: "EMAIL" }
    });
    await prisma.message.create({
      data: {
        workspaceId: manager.workspace.id,
        conversationId: conversation.id,
        direction: "INBOUND",
        senderType: "PROSPECT",
        body: "I am out of office. Pricing and legal disclaimer.",
        metadata: { inboundClassification: { version: 1, kind: "NONMEANINGFUL" } }
      }
    });
    const decisions = `/api/lead-intelligence/leads/${lead.id}/decisions`;
    const waiting = (
      await api("post", decisions, manager.token, manager.workspace.id).send({}).expect(201)
    ).body as LeadIntelligenceDecisionDto;
    expect(waiting.decision).toBe("WAIT");
    expect(waiting.reason).toContain(
      new Date(sequence.createdAt.getTime() + 5 * 86_400_000).toISOString()
    );
    expect(waiting.evidence.some((item) => item.quote.includes("legal disclaimer"))).toBe(false);
    await prisma.followUpAttempt.update({
      where: { id: sequence.attempts[1]?.id },
      data: { scheduledAt: new Date(Date.now() - 1000) }
    });
    expect(
      (
        (await api("post", decisions, manager.token, manager.workspace.id).send({}).expect(201))
          .body as LeadIntelligenceDecisionDto
      ).decision
    ).toBe("WAIT");
    await prisma.followUpSequence.update({
      where: { id: sequence.id },
      data: { createdAt: new Date(Date.now() - 10 * 86_400_000) }
    });
    expect(
      (
        (await api("post", decisions, manager.token, manager.workspace.id).send({}).expect(201))
          .body as LeadIntelligenceDecisionDto
      ).decision
    ).toBe("FOLLOW_UP");
    await prisma.lead.update({
      where: { id: lead.id },
      data: { nextAction: "Wait until the promised date", nextActionAt: tomorrow }
    });
    expect(
      (
        (await api("post", decisions, manager.token, manager.workspace.id).send({}).expect(201))
          .body as LeadIntelligenceDecisionDto
      ).decision
    ).toBe("WAIT");
  });

  it("returns real manager command-center metrics and rejects sales reps", async () => {
    const admin = await identity("command");
    const rep = await identity("command-rep", UserRole.SALES_REP);
    await leadFor(admin, "Command");
    const dashboard = (
      await api(
        "get",
        "/api/lead-intelligence/command-center",
        admin.token,
        admin.workspace.id
      ).expect(200)
    ).body as AiCommandCenterDto;
    expect(dashboard.metrics.activeLeads).toBe(1);
    expect(dashboard.metrics.aiActive).toBe(1);
    expect(dashboard.metrics.pipelineValue).toBe("12000.00");
    expect(dashboard.humanKpis).toMatchObject({
      leadsHandled: 0,
      opportunities: 0,
      conversionRate: 0,
      revenue: "0.00"
    });
    expect(dashboard.aiKpis).toMatchObject({
      followUpsSent: 0,
      repliesGenerated: 0,
      handovers: 0
    });
    expect(dashboard.recommendations[0]?.companyName).toContain("Command");
    await api("get", "/api/lead-intelligence/command-center", rep.token, rep.workspace.id).expect(
      403
    );
  });

  it("counts re-engagement only once per lead after a genuine reply to a sent follow-up", async () => {
    const admin = await identity("reengagement");
    const sentAt = new Date("2026-10-10T10:00:00Z");
    const before = new Date("2026-10-09T10:00:00Z");
    const after = new Date("2026-10-11T10:00:00Z");
    const cases = [
      { label: "unanswered", messages: [], status: "SENT" as const },
      {
        label: "old-reply",
        messages: [{ sentAt: before, createdAt: after }],
        status: "SENT" as const
      },
      {
        label: "auto-reply",
        messages: [
          {
            sentAt: after,
            metadata: { inboundClassification: { version: 1, kind: "NONMEANINGFUL" } }
          }
        ],
        status: "SENT" as const
      },
      { label: "failed-send", messages: [{ sentAt: after }], status: "FAILED" as const },
      {
        label: "human-reply",
        messages: [{ sentAt: after }, { sentAt: after }],
        status: "SENT" as const
      },
      { label: "timestamp-fallback", messages: [{ createdAt: after }], status: "SENT" as const }
    ];
    for (const item of cases) {
      const lead = await leadFor(admin, item.label);
      const conversation = await prisma.conversation.create({
        data: {
          workspaceId: admin.workspace.id,
          leadId: lead.id,
          channel: "EMAIL"
        }
      });
      await prisma.followUpSequence.create({
        data: {
          workspaceId: admin.workspace.id,
          leadId: lead.id,
          contactId: lead.contactId,
          conversationId: conversation.id,
          cadenceDays: [1, 5],
          idempotencyKey: `${marker}-${item.label}`,
          attempts: {
            create: [0, 1].map((stepIndex) => ({
              leadId: lead.id,
              stepIndex,
              kind: "FOLLOW_UP",
              status: item.status,
              scheduledAt: sentAt,
              sentAt: item.status === "SENT" ? sentAt : null,
              subject: "Follow-up",
              textBody: "A grounded question",
              idempotencyKey: `${marker}-${item.label}-${String(stepIndex)}`
            }))
          }
        }
      });
      if (item.messages.length)
        await prisma.message.createMany({
          data: item.messages.map((message) => ({
            workspaceId: admin.workspace.id,
            conversationId: conversation.id,
            direction: "INBOUND",
            senderType: "PROSPECT",
            body: "Persisted reply",
            ...message
          }))
        });
    }
    const dashboard = (
      await api(
        "get",
        "/api/lead-intelligence/command-center",
        admin.token,
        admin.workspace.id
      ).expect(200)
    ).body as AiCommandCenterDto;
    expect(dashboard.aiKpis).toMatchObject({
      followUpsSent: 10,
      reengagements: 2,
      leadsRevived: 2
    });
  });

  it("reports won revenue when no active leads remain", async () => {
    const admin = await identity("command-won-only");
    const lead = await leadFor(admin, "Won only");
    await prisma.deal.create({
      data: {
        workspaceId: admin.workspace.id,
        leadId: lead.id,
        stageId: lead.stageId,
        ownerId: admin.user.id,
        value: "1850000",
        currency: "INR",
        probability: 100,
        status: "WON"
      }
    });
    await prisma.lead.update({
      where: { id: lead.id },
      data: { status: "WON", automationOwnershipState: "AI_STOPPED" }
    });
    await prisma.activity.create({
      data: {
        workspaceId: admin.workspace.id,
        leadId: lead.id,
        actorType: "USER",
        actorUserId: admin.user.id,
        type: "NEGOTIATION_HANDOFF",
        description: "Pricing approval required"
      }
    });

    const dashboard = (
      await api(
        "get",
        "/api/lead-intelligence/command-center",
        admin.token,
        admin.workspace.id
      ).expect(200)
    ).body as AiCommandCenterDto;

    expect(dashboard.metrics.activeLeads).toBe(0);
    expect(dashboard.metrics.pipelineValue).toBe("0.00");
    expect(dashboard.humanKpis).toMatchObject({
      opportunities: 1,
      conversionRate: 100,
      currency: "INR",
      revenue: "1850000.00",
      averageDealValue: "1850000.00"
    });
    expect(dashboard.aiKpis).toMatchObject({ humanInterventions: 1, handovers: 1 });
  });

  it("counts meetings by selected meeting date rather than confirmation date", async () => {
    const admin = await identity("meeting-dates");
    const lead = await leadFor(admin, "Meeting dates");
    const now = new Date();
    const tomorrow = new Date(now.getTime() + 86_400_000);
    for (const [index, status, startsAt] of [
      [0, "CONFIRMED", now], [1, "CONFIRMED", tomorrow], [2, "CANCELLED", now]
    ] as const) {
      const meeting = await prisma.meetingRequest.create({ data: {
        workspaceId: admin.workspace.id, leadId: lead.id, contactId: lead.contactId,
        requestedByUserId: admin.user.id, title: "Meeting date regression", provider: "GOOGLE_CALENDAR",
        status, timeZone: "Pacific/Kiritimati", windowStart: startsAt, windowEnd: new Date(startsAt.getTime() + 3_600_000),
        slotMinutes: 30, durationMinutes: 30, confirmedAt: index === 0 ? new Date(now.getTime() - 86_400_000) : now,
        idempotencyKey: `${marker}:meeting-date:${String(index)}`
      } });
      const slot = await prisma.meetingSlot.create({ data: {
        meetingRequestId: meeting.id, startsAt, endsAt: new Date(startsAt.getTime() + 1_800_000),
        timeZone: meeting.timeZone, status: "SELECTED"
      } });
      await prisma.meetingRequest.update({ where: { id: meeting.id }, data: { selectedSlotId: slot.id } });
    }
    const dashboard = (await api("get", "/api/lead-intelligence/command-center", admin.token, admin.workspace.id).expect(200)).body as AiCommandCenterDto;
    expect(dashboard.metrics.meetingsToday).toBe(1);
  });

  it("keeps command-center recommendations bounded for a large workspace", async () => {
    const admin = await identity("command-volume");
    const seedLead = await leadFor(admin, "Command Volume");
    await prisma.lead.createMany({
      data: Array.from({ length: 750 }, (_, index) => ({
        id: `${marker}-volume-${String(index)}`,
        workspaceId: admin.workspace.id,
        companyId: seedLead.companyId,
        contactId: seedLead.contactId,
        ownerId: admin.user.id,
        source: marker,
        stageId: seedLead.stageId,
        score: index % 101,
        temperature: index % 5 === 0 ? "HOT" : "NURTURE",
        automationOwnershipState: "AI_ACTIVE",
        estimatedValue: "100",
        currency: "USD"
      }))
    });

    const startedAt = performance.now();
    const dashboard = (
      await api(
        "get",
        "/api/lead-intelligence/command-center",
        admin.token,
        admin.workspace.id
      ).expect(200)
    ).body as AiCommandCenterDto;

    expect(dashboard.metrics.activeLeads).toBe(751);
    expect(dashboard.recommendations).toHaveLength(50);
    expect(dashboard.recommendations[0]?.score).toBe(100);
    expect(performance.now() - startedAt).toBeLessThan(5000);
  });

  it("excludes DNC contacts and replaces stale outreach suggestions for stopped leads", async () => {
    const admin = await identity("command-safety");
    const dnc = await leadFor(admin, "Do not contact");
    const stopped = await leadFor(admin, "Stopped");
    await prisma.contact.update({ where: { id: dnc.contactId }, data: { doNotContact: true } });
    await prisma.lead.update({
      where: { id: stopped.id },
      data: { automationOwnershipState: "AI_STOPPED", nextAction: "Send first follow-up email" }
    });

    const dashboard = (
      await api(
        "get",
        "/api/lead-intelligence/command-center",
        admin.token,
        admin.workspace.id
      ).expect(200)
    ).body as AiCommandCenterDto;
    expect(dashboard.metrics.activeLeads).toBe(1);
    expect(dashboard.metrics.aiActive).toBe(0);
    expect(dashboard.recommendations.some((item) => item.leadId === dnc.id)).toBe(false);
    expect(dashboard.recommendations.find((item) => item.leadId === stopped.id)).toMatchObject({
      decision: "STOP",
      recommendation: "AI follow-up is stopped. Review the lead before taking further action."
    });
  });
});
