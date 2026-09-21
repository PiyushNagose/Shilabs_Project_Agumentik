import { DealStatus, UserRole, UserStatus } from "@prisma/client";
import { prisma } from "../../../shared/prisma.js";
import { hashPassword } from "../../auth/auth.service.js";
import type { AuthenticatedUser } from "../../auth/auth.types.js";
import type { FetchTransport } from "./zoho-bigin.client.js";
import { syncZohoDeals } from "./zoho-bigin-deal-sync.service.js";

const actorEmail = "r4-deal-sync-admin@example.local";
let actor: AuthenticatedUser;

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

function dealsResponse(amount = "45000", contactId = "r4-zoho-contact-1"): Response {
  return Response.json({
    data: [
      {
        id: "r4-zoho-deal-1",
        Deal_Name: "Website Redesign",
        Amount: amount,
        Currency: "INR",
        Stage: "Qualified",
        Probability: 50,
        Modified_Time: "2026-09-15T10:00:00+05:30",
        Contact_Name: {
          id: contactId,
          name: "Priya Nair"
        }
      }
    ],
    info: { more_records: false }
  });
}

async function cleanup(): Promise<void> {
  const mappings = await prisma.externalRecordMapping.findMany({
    where: {
      provider: "ZOHO_BIGIN",
      OR: [
        { externalRecordId: { startsWith: "r4-zoho-" } },
        { idempotencyKey: { startsWith: "zoho-bigin:deal:r4-" } }
      ]
    }
  });
  const dealIds = mappings
    .filter((mapping) => mapping.entityType === "DEAL")
    .map((mapping) => mapping.localEntityId);
  const leadIds = mappings
    .filter((mapping) => mapping.entityType === "LEAD")
    .map((mapping) => mapping.localEntityId);
  const contactIds = mappings
    .filter((mapping) => mapping.entityType === "CONTACT")
    .map((mapping) => mapping.localEntityId);
  const companyIds = mappings
    .filter((mapping) => mapping.entityType === "COMPANY")
    .map((mapping) => mapping.localEntityId);

  await prisma.externalRecordMapping.deleteMany({
    where: { provider: "ZOHO_BIGIN", externalRecordId: { startsWith: "r4-zoho-" } }
  });
  await prisma.deal.deleteMany({ where: { id: { in: dealIds } } });
  await prisma.lead.deleteMany({ where: { id: { in: leadIds } } });
  await prisma.contact.deleteMany({ where: { id: { in: contactIds } } });
  await prisma.company.deleteMany({ where: { id: { in: companyIds } } });
  await prisma.integrationSyncRun.deleteMany({
    where: { provider: "ZOHO_BIGIN", operation: "DEAL_SYNC", requestedByUserId: actor.id }
  });
}

async function createMappedLead(): Promise<string> {
  const stage = await prisma.pipelineStage.findUniqueOrThrow({ where: { key: "NEW" } });
  const company = await prisma.company.create({ data: { name: "R4 Deal Company" } });
  const contact = await prisma.contact.create({
    data: {
      companyId: company.id,
      firstName: "Priya",
      lastName: "Nair",
      email: "priya@example.local",
      normalizedEmail: "priya@example.local"
    }
  });
  const lead = await prisma.lead.create({
    data: {
      companyId: company.id,
      contactId: contact.id,
      stageId: stage.id,
      source: "ZOHO_BIGIN",
      score: 66,
      nextAction: "Preserve me"
    }
  });
  await prisma.externalRecordMapping.createMany({
    data: [
      {
        provider: "ZOHO_BIGIN",
        entityType: "COMPANY",
        localEntityId: company.id,
        externalRecordId: "r4-zoho-account-1",
        syncStatus: "SYNCED",
        syncDirection: "INBOUND"
      },
      {
        provider: "ZOHO_BIGIN",
        entityType: "CONTACT",
        localEntityId: contact.id,
        externalRecordId: "r4-zoho-contact-1",
        syncStatus: "SYNCED",
        syncDirection: "INBOUND"
      },
      {
        provider: "ZOHO_BIGIN",
        entityType: "LEAD",
        localEntityId: lead.id,
        externalRecordId: "r4-zoho-contact-1",
        syncStatus: "SYNCED",
        syncDirection: "INBOUND"
      }
    ]
  });
  return lead.id;
}

describe("Zoho deal sync", () => {
  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { email: actorEmail } });
    const user = await prisma.user.create({
      data: {
        email: actorEmail,
        passwordHash: await hashPassword("CorrectHorse123!"),
        firstName: "R4",
        lastName: "Admin",
        role: UserRole.ADMIN,
        status: UserStatus.ACTIVE
      }
    });
    actor = {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      status: user.status,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt
    };
  });

  beforeEach(async () => {
    await cleanup();
  });

  afterAll(async () => {
    await cleanup();
    await prisma.user.deleteMany({ where: { email: actorEmail } });
    await prisma.$disconnect();
  });

  it("truthfully skips sync when Zoho is not configured", async () => {
    const result = await syncZohoDeals({ actor, env: {} });

    expect(result.status).toBe("NOT_CONFIGURED");
    expect(result.totalRecords).toBe(0);
  });

  it("syncs mapped Zoho deals idempotently without changing lead automation state", async () => {
    const leadId = await createMappedLead();
    const transport = vi
      .fn<FetchTransport>()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(dealsResponse());

    const first = await syncZohoDeals({ actor, env, transport });
    expect(first.status).toBe("COMPLETED");
    expect(first.succeededRecords).toBe(1);

    const dealMapping = await prisma.externalRecordMapping.findUniqueOrThrow({
      where: {
        provider_entityType_externalRecordId: {
          provider: "ZOHO_BIGIN",
          entityType: "DEAL",
          externalRecordId: "r4-zoho-deal-1"
        }
      }
    });
    await prisma.deal.update({
      where: { id: dealMapping.localEntityId },
      data: { proposalStatus: "DRAFT" }
    });

    const secondTransport = vi
      .fn<FetchTransport>()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(dealsResponse("50000"));
    const second = await syncZohoDeals({ actor, env, transport: secondTransport });

    expect(second.succeededRecords).toBe(1);
    await expect(
      prisma.externalRecordMapping.count({
        where: { entityType: "DEAL", externalRecordId: "r4-zoho-deal-1" }
      })
    ).resolves.toBe(1);

    const deal = await prisma.deal.findUniqueOrThrow({ where: { id: dealMapping.localEntityId } });
    expect(deal.value?.toString()).toBe("50000");
    expect(deal.status).toBe(DealStatus.OPEN);
    expect(deal.proposalStatus).toBe("DRAFT");

    const lead = await prisma.lead.findUniqueOrThrow({ where: { id: leadId } });
    expect(lead.score).toBe(66);
    expect(lead.nextAction).toBe("Preserve me");
  });

  it("skips Zoho deals whose related lead/contact is not mapped locally", async () => {
    const transport = vi
      .fn<FetchTransport>()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(dealsResponse("45000", "r4-zoho-contact-unmapped"));

    const result = await syncZohoDeals({ actor, env, transport });

    expect(result.status).toBe("COMPLETED");
    expect(result.skippedRecords).toBe(1);
    await expect(prisma.deal.count({ where: { value: "45000" } })).resolves.toBe(0);
  });
});
