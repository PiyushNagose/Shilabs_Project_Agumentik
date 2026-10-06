import { PrismaClient, ActivityType, AuditActorType, UserRole } from "@prisma/client";
import { afterEach } from "vitest";

const databaseUrl = process.env.DATABASE_URL;
const runDatabaseTests = databaseUrl === undefined ? describe.skip : describe;

runDatabaseTests("database schema integration", () => {
  const prisma = new PrismaClient();

  afterEach(async () => {
    const companies = await prisma.company.findMany({
      where: { name: { startsWith: "Relationship Test " } },
      select: { id: true }
    });
    const companyIds = companies.map((company) => company.id);
    const leads = await prisma.lead.findMany({
      where: { companyId: { in: companyIds } },
      select: { id: true }
    });
    await prisma.auditEvent.deleteMany({
      where: { entityType: "Lead", entityId: { in: leads.map((lead) => lead.id) } }
    });
    await prisma.activity.deleteMany({ where: { lead: { companyId: { in: companyIds } } } });
    await prisma.lead.deleteMany({ where: { companyId: { in: companyIds } } });
    await prisma.contact.deleteMany({ where: { companyId: { in: companyIds } } });
    await prisma.company.deleteMany({ where: { id: { in: companyIds } } });
    await prisma.user.deleteMany({ where: { email: { startsWith: "owner-" } } });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("contains the seeded pipeline stages in canonical order", async () => {
    const stages = await prisma.pipelineStage.findMany({ orderBy: { order: "asc" } });
    const canonicalKeys = [
      "NEW",
      "CONTACTED",
      "ENGAGED",
      "QUALIFIED",
      "MEETING_BOOKED",
      "PROPOSAL",
      "NEGOTIATION",
      "WON",
      "LOST",
      "NURTURE"
    ];
    const canonicalStages = stages.filter((stage) => canonicalKeys.includes(stage.key));

    expect(canonicalStages.map((stage) => stage.key)).toEqual(canonicalKeys);
    expect(stages.find((stage) => stage.key === "WON")).toMatchObject({
      probability: 100,
      isClosed: true,
      isWon: true,
      isLost: false
    });
    expect(stages.find((stage) => stage.key === "LOST")).toMatchObject({
      probability: 0,
      isClosed: true,
      isWon: false,
      isLost: true
    });
  });

  it("enforces important relationships and contact duplicate assumptions", async () => {
    const suffix = `${String(Date.now())}-${Math.random().toString(36).slice(2)}`;
    const user = await prisma.user.create({
      data: {
        email: `owner-${suffix}@example.local`,
        passwordHash: "test-only-password-hash",
        firstName: "Test",
        lastName: "Owner",
        role: UserRole.SALES_REP
      }
    });
    const company = await prisma.company.create({
      data: { name: `Relationship Test ${suffix}`, website: `https://${suffix}.example.local` }
    });
    const contact = await prisma.contact.create({
      data: {
        companyId: company.id,
        firstName: "Priya",
        lastName: "Prospect",
        normalizedEmail: `priya-${suffix}@example.local`
      }
    });
    const newStage = await prisma.pipelineStage.findUniqueOrThrow({ where: { key: "NEW" } });
    const lead = await prisma.lead.create({
      data: {
        companyId: company.id,
        contactId: contact.id,
        ownerId: user.id,
        source: "TEST",
        stageId: newStage.id
      }
    });

    await prisma.activity.create({
      data: {
        leadId: lead.id,
        actorUserId: user.id,
        type: ActivityType.LEAD_CREATED,
        description: "Test lead created"
      }
    });
    await prisma.auditEvent.create({
      data: {
        actorType: AuditActorType.USER,
        actorId: user.id,
        entityType: "Lead",
        entityId: lead.id,
        action: "LEAD_CREATED",
        after: { leadId: lead.id }
      }
    });

    await expect(
      prisma.contact.create({
        data: {
          companyId: company.id,
          firstName: "Duplicate",
          lastName: "Prospect",
          normalizedEmail: `priya-${suffix}@example.local`
        }
      })
    ).rejects.toThrow();
  });
});
