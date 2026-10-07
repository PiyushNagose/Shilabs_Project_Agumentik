import { UserRole, UserStatus } from "@prisma/client";
import { prisma } from "../../../shared/prisma.js";
import { hashPassword } from "../../auth/auth.service.js";
import type { FetchTransport } from "./zoho-bigin.client.js";
import { appendActivityToZohoTimeline } from "./zoho-bigin-timeline.service.js";

const actorEmail = "r4-timeline-admin@example.local";

const env = {
  ZOHO_BIGIN_CLIENT_ID: "client-id",
  ZOHO_BIGIN_CLIENT_SECRET: "client-secret",
  ZOHO_BIGIN_REFRESH_TOKEN: "refresh-token",
  ZOHO_BIGIN_ACCOUNTS_URL: "https://accounts.zoho.com",
  ZOHO_BIGIN_API_DOMAIN: "https://www.zohoapis.com",
  ZOHO_BIGIN_REQUIRED_SCOPES: "ZohoBigin.modules.ALL",
  ZOHO_BIGIN_TIMEOUT_MS: "1000",
  ZOHO_BIGIN_MAX_RETRIES: "1",
  ZOHO_BIGIN_TOKEN_SKEW_SECONDS: "60",
  ZOHO_BIGIN_CONTACTS_MODULE: "Contacts",
  ZOHO_BIGIN_DEALS_MODULE: "Pipelines",
  ZOHO_BIGIN_TIMELINE_RELATED_MODULE: "Contacts",
  ZOHO_BIGIN_SYNC_PER_PAGE: "200",
  ZOHO_BIGIN_SYNC_MAX_PAGES: "2"
};

function tokenResponse(): Response {
  return Response.json({
    access_token: "access-token",
    api_domain: "https://www.zohoapis.com",
    token_type: "Bearer",
    expires_in: 3600,
    scope: "ZohoBigin.modules.ALL"
  });
}

function noteSuccessResponse(): Response {
  return Response.json({
    data: [{ status: "success", details: { id: "r4-zoho-note-1" } }]
  });
}

async function cleanup(): Promise<void> {
  const mappings = await prisma.externalRecordMapping.findMany({
    where: { provider: "ZOHO_BIGIN", externalRecordId: { startsWith: "r4-timeline-" } }
  });
  const leadIds = mappings
    .filter((mapping) => mapping.entityType === "LEAD")
    .map((mapping) => mapping.localEntityId);
  const activityIds = mappings
    .filter((mapping) => mapping.entityType === "ACTIVITY")
    .map((mapping) => mapping.localEntityId);

  await prisma.externalRecordMapping.deleteMany({
    where: {
      provider: "ZOHO_BIGIN",
      OR: [
        { externalRecordId: { startsWith: "r4-timeline-" } },
        { externalRecordId: "r4-zoho-note-1" }
      ]
    }
  });
  await prisma.activity.deleteMany({
    where: { OR: [{ id: { in: activityIds } }, { leadId: { in: leadIds } }] }
  });
  await prisma.deal.deleteMany({ where: { leadId: { in: leadIds } } });
  await prisma.lead.deleteMany({ where: { id: { in: leadIds } } });
  await prisma.contact.deleteMany({ where: { email: "timeline@example.local" } });
  await prisma.company.deleteMany({ where: { name: "R4 Timeline Company" } });
}

async function createMappedActivity(): Promise<string> {
  const workspace = await prisma.workspace.findUniqueOrThrow({ where: { slug: "default" } });
  const user = await prisma.user.upsert({
    where: { email: actorEmail },
    create: {
      email: actorEmail,
      passwordHash: await hashPassword("CorrectHorse123!"),
      firstName: "Timeline",
      lastName: "Admin",
      role: UserRole.ADMIN,
      status: UserStatus.ACTIVE
    },
    update: {}
  });
  const stage = await prisma.pipelineStage.findUniqueOrThrow({ where: { key: "NEW" } });
  const company = await prisma.company.create({ data: { workspaceId: workspace.id, name: "R4 Timeline Company" } });
  const contact = await prisma.contact.create({
    data: {
      workspaceId: workspace.id,
      companyId: company.id,
      firstName: "Timeline",
      lastName: "Contact",
      email: "timeline@example.local",
      normalizedEmail: "timeline@example.local"
    }
  });
  const lead = await prisma.lead.create({
    data: {
      workspaceId: workspace.id,
      companyId: company.id,
      contactId: contact.id,
      stageId: stage.id,
      source: "ZOHO_BIGIN"
    }
  });
  const activity = await prisma.activity.create({
    data: {
      workspaceId: workspace.id,
      leadId: lead.id,
      actorUserId: user.id,
      type: "NOTE_ADDED",
      description: "Confirmed local note"
    }
  });
  await prisma.externalRecordMapping.create({
    data: {
      workspaceId: workspace.id,
      provider: "ZOHO_BIGIN",
      entityType: "LEAD",
      localEntityId: lead.id,
      externalRecordId: "r4-timeline-contact-1",
      syncStatus: "SYNCED",
      syncDirection: "INBOUND"
    }
  });
  return activity.id;
}

describe("Zoho timeline append", () => {
  beforeEach(async () => {
    await cleanup();
  });

  afterAll(async () => {
    await cleanup();
    await prisma.user.deleteMany({ where: { email: actorEmail } });
    await prisma.$disconnect();
  });

  it("creates a local mapping only after Zoho confirms the timeline write", async () => {
    const activityId = await createMappedActivity();
    const transport = vi
      .fn<FetchTransport>()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(noteSuccessResponse());

    const first = await appendActivityToZohoTimeline({ activityId, env, transport });
    expect(first.status).toBe("SYNCED");
    expect(first.externalRecordId).toBe("r4-zoho-note-1");

    const second = await appendActivityToZohoTimeline({ activityId, env, transport });
    expect(second.status).toBe("SKIPPED");
    expect(transport).toHaveBeenCalledTimes(2);
  });

  it("does not create a successful timeline mapping when Zoho rejects the write", async () => {
    const activityId = await createMappedActivity();
    const transport = vi
      .fn<FetchTransport>()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(Response.json({ data: [{ status: "error", code: "INVALID_DATA" }] }));

    const result = await appendActivityToZohoTimeline({ activityId, env, transport });

    expect(result.status).toBe("FAILED");
    await expect(
      prisma.externalRecordMapping.findFirst({
        where: {
          provider: "ZOHO_BIGIN",
          entityType: "ACTIVITY",
          localEntityId: activityId
        }
      })
    ).resolves.toBeNull();
  });
});
