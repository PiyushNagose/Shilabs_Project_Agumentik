import { UserRole, UserStatus } from "@prisma/client";
import { prisma } from "../../../shared/prisma.js";
import { hashPassword } from "../../auth/auth.service.js";
import type { AuthenticatedUser } from "../../auth/auth.types.js";
import type { FetchTransport } from "./zoho-bigin.client.js";
import { syncZohoLeadContacts } from "./zoho-bigin-sync.service.js";

const actorEmail = "r3-sync-admin@example.local";
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

function contactsResponse(phone = "+91 98765 43210"): Response {
  return Response.json({
    data: [
      {
        id: "r3-zoho-contact-1",
        First_Name: "Priya",
        Last_Name: "Nair",
        Email: "Priya@Example.com",
        Phone: phone,
        Lead_Source: "Website",
        Modified_Time: "2026-09-15T10:00:00+05:30",
        Account_Name: {
          id: "r3-zoho-account-1",
          name: "R3 Account"
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
        { externalRecordId: { startsWith: "r3-zoho-" } },
        { localEntityId: { startsWith: "r3-" } }
      ]
    }
  });
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
    where: { provider: "ZOHO_BIGIN", externalRecordId: { startsWith: "r3-zoho-" } }
  });
  await prisma.lead.deleteMany({ where: { id: { in: leadIds } } });
  await prisma.contact.deleteMany({ where: { id: { in: contactIds } } });
  await prisma.company.deleteMany({
    where: { OR: [{ id: { in: companyIds } }, { name: "R3 Account" }] }
  });
  await prisma.integrationSyncRun.deleteMany({
    where: { provider: "ZOHO_BIGIN", operation: "LEAD_CONTACT_SYNC", requestedByUserId: actor.id }
  });
}

describe("Zoho lead/contact sync", () => {
  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { email: actorEmail } });
    const user = await prisma.user.create({
      data: {
        email: actorEmail,
        passwordHash: await hashPassword("CorrectHorse123!"),
        firstName: "R3",
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
    const result = await syncZohoLeadContacts({
      actor,
      env: {}
    });

    expect(result.status).toBe("NOT_CONFIGURED");
    expect(result.totalRecords).toBe(0);
    await expect(
      prisma.integrationSyncRun.findUnique({ where: { id: result.runId ?? "" } })
    ).resolves.toMatchObject({
      status: "SKIPPED"
    });
  });

  it("imports Zoho contacts into mapped local company, contact and lead records idempotently", async () => {
    const transport = vi
      .fn<FetchTransport>()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(contactsResponse());

    const first = await syncZohoLeadContacts({ actor, env, transport });
    expect(first.status).toBe("COMPLETED");
    expect(first.succeededRecords).toBe(1);

    const leadMapping = await prisma.externalRecordMapping.findUniqueOrThrow({
      where: {
        provider_entityType_externalRecordId: {
          provider: "ZOHO_BIGIN",
          entityType: "LEAD",
          externalRecordId: "r3-zoho-contact-1"
        }
      }
    });
    await prisma.lead.update({
      where: { id: leadMapping.localEntityId },
      data: {
        score: 77,
        nextAction: "Call after proposal review"
      }
    });

    const secondTransport = vi
      .fn<FetchTransport>()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(contactsResponse("+91 90000 00000"));
    const second = await syncZohoLeadContacts({ actor, env, transport: secondTransport });

    expect(second.status).toBe("COMPLETED");
    expect(second.succeededRecords).toBe(1);

    await expect(
      prisma.externalRecordMapping.count({ where: { externalRecordId: "r3-zoho-contact-1" } })
    ).resolves.toBe(2);
    const contact = await prisma.contact.findUniqueOrThrow({
      where: {
        id: (
          await prisma.externalRecordMapping.findUniqueOrThrow({
            where: {
              provider_entityType_externalRecordId: {
                provider: "ZOHO_BIGIN",
                entityType: "CONTACT",
                externalRecordId: "r3-zoho-contact-1"
              }
            }
          })
        ).localEntityId
      }
    });
    expect(contact.normalizedPhone).toBe("919000000000");

    const lead = await prisma.lead.findUniqueOrThrow({ where: { id: leadMapping.localEntityId } });
    expect(lead.score).toBe(77);
    expect(lead.nextAction).toBe("Call after proposal review");
  });
});
