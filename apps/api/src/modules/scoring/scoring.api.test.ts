import { randomUUID } from "node:crypto";
import request from "supertest";
import { UserRole, UserStatus } from "@prisma/client";
import type { AuthResponse, LeadScoreResultDto, ScoringConfigDto } from "@shilabs/shared-types";
import { createApp } from "../../app.js";
import { prisma } from "../../shared/prisma.js";
import { hashPassword } from "../auth/auth.service.js";

const app = createApp();
const adminEmail = "scoring-api-admin@example.local";
const repEmail = "scoring-api-rep@example.local";
const companyNamePrefix = "M11 Scoring API Company";
const defaultScoringConfig = {
  key: "default",
  requirementWeight: 20,
  authorityWeight: 20,
  budgetWeight: 20,
  timelineWeight: 20,
  businessFitWeight: 20,
  warmThreshold: 60,
  hotThreshold: 80
};

async function login(email: string): Promise<string> {
  const response = await request(app)
    .post("/api/auth/login")
    .send({ email, password: "CorrectHorse123!" })
    .expect(200);
  return (response.body as unknown as AuthResponse).accessToken;
}

async function seedBaseData(): Promise<void> {
  await prisma.pipelineStage.upsert({
    where: { key: "NEW" },
    create: {
      key: "NEW",
      label: "New",
      order: 10,
      probability: 5,
      isClosed: false,
      isWon: false,
      isLost: false
    },
    update: {}
  });
  await prisma.scoringConfig.upsert({
    where: { key: defaultScoringConfig.key },
    create: defaultScoringConfig,
    update: defaultScoringConfig
  });
  const passwordHash = await hashPassword("CorrectHorse123!");
  await prisma.user.createMany({
    data: [
      {
        email: adminEmail,
        passwordHash,
        firstName: "Scoring",
        lastName: "Admin",
        role: UserRole.ADMIN,
        status: UserStatus.ACTIVE
      },
      {
        email: repEmail,
        passwordHash,
        firstName: "Scoring",
        lastName: "Rep",
        role: UserRole.SALES_REP,
        status: UserStatus.ACTIVE
      }
    ]
  });
}

async function cleanup(): Promise<void> {
  await prisma.authSession.deleteMany({
    where: { user: { email: { in: [adminEmail, repEmail] } } }
  });
  await prisma.leadQualificationEvidence.deleteMany({
    where: { qualification: { lead: { company: { name: { startsWith: companyNamePrefix } } } } }
  });
  await prisma.leadQualification.deleteMany({
    where: { lead: { company: { name: { startsWith: companyNamePrefix } } } }
  });
  await prisma.leadScoreRun.deleteMany({
    where: { lead: { company: { name: { startsWith: companyNamePrefix } } } }
  });
  await prisma.message.deleteMany({
    where: { conversation: { lead: { company: { name: { startsWith: companyNamePrefix } } } } }
  });
  await prisma.conversation.deleteMany({
    where: { lead: { company: { name: { startsWith: companyNamePrefix } } } }
  });
  await prisma.activity.deleteMany({
    where: { lead: { company: { name: { startsWith: companyNamePrefix } } } }
  });
  await prisma.auditEvent.deleteMany({
    where: {
      OR: [
        { entityType: "Lead", action: "LEAD_SCORE_CHANGED" },
        { entityType: "ScoringConfig", action: "SCORING_CONFIG_UPDATED" },
        { entityType: "LeadQualification" }
      ]
    }
  });
  await prisma.deal.deleteMany({
    where: { lead: { company: { name: { startsWith: companyNamePrefix } } } }
  });
  await prisma.lead.deleteMany({ where: { company: { name: { startsWith: companyNamePrefix } } } });
  await prisma.contact.deleteMany({
    where: { company: { name: { startsWith: companyNamePrefix } } }
  });
  await prisma.company.deleteMany({ where: { name: { startsWith: companyNamePrefix } } });
  await prisma.user.deleteMany({ where: { email: { in: [adminEmail, repEmail] } } });
  await prisma.scoringConfig.upsert({
    where: { key: defaultScoringConfig.key },
    create: defaultScoringConfig,
    update: defaultScoringConfig
  });
}

async function createQualifiedLead(): Promise<string> {
  const admin = await prisma.user.findUniqueOrThrow({ where: { email: adminEmail } });
  const uniqueSlug = `m11-${randomUUID()}`;
  const company = await prisma.company.create({
    data: { name: `${companyNamePrefix} ${uniqueSlug}` }
  });
  const contact = await prisma.contact.create({
    data: {
      companyId: company.id,
      firstName: "Score",
      lastName: "Prospect",
      email: `${uniqueSlug}@example.local`
    }
  });
  const stage = await prisma.pipelineStage.findUniqueOrThrow({ where: { key: "NEW" } });
  const lead = await prisma.lead.create({
    data: {
      companyId: company.id,
      contactId: contact.id,
      ownerId: admin.id,
      stageId: stage.id,
      source: "website",
      score: 0,
      temperature: "NURTURE"
    }
  });
  await prisma.leadQualification.create({
    data: {
      leadId: lead.id,
      requirement: "Real estate website",
      authority: "Owner",
      budgetBand: "5000-10000 USD",
      timeline: "this month",
      businessFit: "Strong fit for web development",
      decisionMakerIdentified: true
    }
  });
  return lead.id;
}

describe("M11 scoring API", () => {
  beforeEach(async () => {
    await cleanup();
    await seedBaseData();
  }, 45000);

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  }, 45000);

  it("returns scoring config for authenticated users and restricts updates to admins", async () => {
    const adminToken = await login(adminEmail);
    const repToken = await login(repEmail);

    await request(app).get("/api/scoring/config").expect(401);
    const configResponse = await request(app)
      .get("/api/scoring/config")
      .set("Authorization", `Bearer ${repToken}`)
      .expect(200);
    const config = configResponse.body as unknown as ScoringConfigDto;
    expect(config.requirementWeight).toBe(20);

    await request(app)
      .patch("/api/scoring/config")
      .set("Authorization", `Bearer ${repToken}`)
      .send({ hotThreshold: 85 })
      .expect(403);
    await request(app)
      .patch("/api/scoring/config")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ warmThreshold: 90, hotThreshold: 80 })
      .expect(400);

    const updateResponse = await request(app)
      .patch("/api/scoring/config")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ hotThreshold: 85, warmThreshold: 55 })
      .expect(200);
    const updated = updateResponse.body as unknown as ScoringConfigDto;
    expect(updated.hotThreshold).toBe(85);
    expect(updated.warmThreshold).toBe(55);

    await prisma.auditEvent.findFirstOrThrow({
      where: { entityType: "ScoringConfig", action: "SCORING_CONFIG_UPDATED" }
    });
  }, 45000);

  it("recalculates score from persisted qualification and audits the change", async () => {
    const adminToken = await login(adminEmail);
    const leadId = await createQualifiedLead();

    const response = await request(app)
      .post(`/api/leads/${leadId}/recalculate-score`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);
    const result = response.body as unknown as LeadScoreResultDto;

    expect(result.score).toBe(100);
    expect(result.temperature).toBe("HOT");
    expect(result.persisted).toBe(true);
    expect(result.skippedReason).toBeNull();
    expect(result.runId).toEqual(expect.any(String));
    expect(result.factors.every((factor) => factor.matched)).toBe(true);

    const lead = await prisma.lead.findUniqueOrThrow({ where: { id: leadId } });
    expect(lead.score).toBe(100);
    expect(lead.temperature).toBe("HOT");

    await prisma.activity.findFirstOrThrow({ where: { leadId, type: "SCORE_CHANGED" } });
    await prisma.leadScoreRun.findFirstOrThrow({
      where: { id: result.runId ?? "", leadId, source: "RULE_ENGINE", status: "COMPLETED" }
    });
    await prisma.auditEvent.findFirstOrThrow({
      where: { entityType: "Lead", entityId: leadId, action: "LEAD_SCORE_CHANGED" }
    });
  }, 45000);

  it("preserves human score overrides and skips automatic overwrite", async () => {
    const adminToken = await login(adminEmail);
    const repToken = await login(repEmail);
    const leadId = await createQualifiedLead();

    await request(app)
      .patch(`/api/leads/${leadId}/score-override`)
      .set("Authorization", `Bearer ${repToken}`)
      .send({ score: 42, reason: "Manual sales review" })
      .expect(403);

    const overrideResponse = await request(app)
      .patch(`/api/leads/${leadId}/score-override`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ score: 42, reason: "Manual sales review" })
      .expect(200);
    const override = overrideResponse.body as unknown as { runId: string };

    await expect(
      prisma.leadScoreRun.findUniqueOrThrow({ where: { id: override.runId } })
    ).resolves.toMatchObject({ source: "MANUAL_OVERRIDE", status: "COMPLETED", score: 42 });

    const recalcResponse = await request(app)
      .post(`/api/leads/${leadId}/recalculate-score`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);
    const result = recalcResponse.body as unknown as LeadScoreResultDto;

    expect(result.score).toBe(42);
    expect(result.persisted).toBe(false);
    expect(result.skippedReason).toBe("Active human score override prevents automatic recalculation");
    await expect(prisma.lead.findUniqueOrThrow({ where: { id: leadId } })).resolves.toMatchObject({
      score: 42,
      scoreOverrideReason: "Manual sales review"
    });
    await expect(
      prisma.leadScoreRun.findUniqueOrThrow({ where: { id: result.runId ?? "" } })
    ).resolves.toMatchObject({ source: "RULE_ENGINE", status: "SKIPPED" });
  }, 45000);

  it("rejects attempts to put score data into qualification updates", async () => {
    const adminToken = await login(adminEmail);
    const leadId = await createQualifiedLead();

    await request(app)
      .patch(`/api/leads/${leadId}/qualification`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ score: 100 })
      .expect(400);
  }, 45000);
});
