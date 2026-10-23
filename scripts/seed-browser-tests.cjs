const { assertTestDatabaseEnvironment } = require("./verify-test-environment.cjs");

assertTestDatabaseEnvironment();
const url = new URL(process.env.DATABASE_URL);
if (process.env.CI !== "true" || !/^codex_test_[A-Za-z0-9_]+$/.test(url.searchParams.get("schema") ?? "")) {
  throw new Error("Browser fixtures require CI and an explicitly isolated codex_test_* schema");
}

const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  const member = await prisma.workspaceMember.findFirst({
    where: { user: { email: process.env.DEV_ADMIN_EMAIL }, status: "ACTIVE" },
    orderBy: { joinedAt: "asc" }
  });
  if (!member) throw new Error("Seed the CI administrator before browser fixtures");
  const stage = await prisma.pipelineStage.findFirst({
    where: { isClosed: false, OR: [{ workspaceId: member.workspaceId }, { workspaceId: null }] },
    orderBy: { order: "asc" }
  });
  if (!stage) throw new Error("Seed pipeline stages before browser fixtures");
  await prisma.$transaction(async (tx) => {
    const company = await tx.company.upsert({
      where: { id: "ci_browser_company" },
      create: { id: "ci_browser_company", workspaceId: member.workspaceId, name: "Browser Verification Company" },
      update: {}
    });
    const contact = await tx.contact.upsert({
      where: { id: "ci_browser_contact" },
      create: {
        id: "ci_browser_contact", workspaceId: member.workspaceId, companyId: company.id,
        firstName: "Browser", lastName: "Verification", email: "browser@example.test",
        normalizedEmail: "browser@example.test"
      },
      update: {}
    });
    await tx.lead.upsert({
      where: { id: "ci_browser_lead" },
      create: {
        id: "ci_browser_lead", workspaceId: member.workspaceId, companyId: company.id,
        contactId: contact.id, ownerId: member.userId, stageId: stage.id, source: "CI"
      },
      update: {}
    });
    await tx.followUpPolicy.upsert({
      where: { workspaceId_name: { workspaceId: member.workspaceId, name: "Browser verification schedule" } },
      create: {
        workspaceId: member.workspaceId, name: "Browser verification schedule", companyId: company.id,
        communicationPersonality: "Warm and concise.", cadenceDays: [1, 5, 9], enabled: false
      },
      update: {}
    });
  });
  console.log("Prepared isolated CI browser fixtures; no outreach or production records created.");
}

main().catch(() => {
  console.error("Isolated browser fixture setup failed");
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
