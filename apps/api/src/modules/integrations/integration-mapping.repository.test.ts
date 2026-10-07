import { Prisma } from "@prisma/client";
import { prisma } from "../../shared/prisma.js";
import {
  createExternalRecordMapping,
  findIntegrationAccount,
  findMappingByExternalRecord,
  findMappingByLocalRecord,
  markMappingFailed,
  markMappingSynced,
  upsertIntegrationAccount
} from "./integration-mapping.repository.js";

const accountKey = "r1-test";
const workspaceSlugs = ["r1-mapping-a", "r1-mapping-b"];

async function workspaceId(slug = workspaceSlugs[0] ?? "r1-mapping-a"): Promise<string> {
  return (await prisma.workspace.findUniqueOrThrow({ where: { slug } })).id;
}

describe("integration mapping repository", () => {
  beforeEach(async () => {
    await prisma.externalRecordMapping.deleteMany({
      where: { provider: "ZOHO_BIGIN", localEntityId: { startsWith: "r1-" } }
    });
    await prisma.integrationAccount.deleteMany({
      where: { provider: "ZOHO_BIGIN", key: accountKey }
    });
    await prisma.workspace.deleteMany({ where: { slug: { in: workspaceSlugs } } });
    await prisma.workspace.createMany({
      data: workspaceSlugs.map((slug) => ({ name: slug, slug }))
    });
  });

  afterAll(async () => {
    await prisma.externalRecordMapping.deleteMany({
      where: { provider: "ZOHO_BIGIN", localEntityId: { startsWith: "r1-" } }
    });
    await prisma.integrationAccount.deleteMany({
      where: { provider: "ZOHO_BIGIN", key: accountKey }
    });
    await prisma.workspace.deleteMany({ where: { slug: { in: workspaceSlugs } } });
    await prisma.$disconnect();
  });

  it("stores integration account configuration without plaintext secrets", async () => {
    const account = await upsertIntegrationAccount({
      workspaceId: await workspaceId(),
      provider: "ZOHO_BIGIN",
      key: accountKey,
      displayName: "R1 Test Zoho Bigin",
      status: "NOT_CONFIGURED",
      secretRef: "env:ZOHO_BIGIN_CLIENT_SECRET",
      publicConfig: { apiDomain: "https://www.zohoapis.com" }
    });

    expect(account.status).toBe("NOT_CONFIGURED");
    expect(account.secretRef).toBe("env:ZOHO_BIGIN_CLIENT_SECRET");
    expect(JSON.stringify(account.publicConfig)).not.toContain("secret");

    await expect(
      findIntegrationAccount({ workspaceId: await workspaceId(), provider: "ZOHO_BIGIN", key: accountKey })
    ).resolves.toMatchObject({
      id: account.id
    });
  });

  it("maps one local record to one external record with idempotency metadata", async () => {
    const account = await upsertIntegrationAccount({
      workspaceId: await workspaceId(),
      provider: "ZOHO_BIGIN",
      key: accountKey,
      displayName: "R1 Test Zoho Bigin",
      status: "NOT_CONFIGURED"
    });

    const mapping = await createExternalRecordMapping({
      workspaceId: await workspaceId(),
      integrationAccountId: account.id,
      provider: "ZOHO_BIGIN",
      entityType: "LEAD",
      localEntityId: "r1-local-lead-1",
      externalRecordId: "zoho-lead-1",
      syncDirection: "BIDIRECTIONAL",
      syncStatus: "PENDING",
      idempotencyKey: "r1-idempotency-lead-1"
    });

    await expect(
      findMappingByLocalRecord({
        workspaceId: await workspaceId(),
        provider: "ZOHO_BIGIN",
        entityType: "LEAD",
        localEntityId: "r1-local-lead-1"
      })
    ).resolves.toMatchObject({ id: mapping.id });

    await expect(
      findMappingByExternalRecord({
        workspaceId: await workspaceId(),
        provider: "ZOHO_BIGIN",
        entityType: "LEAD",
        externalRecordId: "zoho-lead-1"
      })
    ).resolves.toMatchObject({ id: mapping.id });
  });

  it("enforces duplicate-safe local, external and idempotency uniqueness", async () => {
    await createExternalRecordMapping({
      workspaceId: await workspaceId(),
      provider: "ZOHO_BIGIN",
      entityType: "CONTACT",
      localEntityId: "r1-local-contact-1",
      externalRecordId: "zoho-contact-1",
      idempotencyKey: "r1-idempotency-contact-1"
    });

    await expect(
      createExternalRecordMapping({
        workspaceId: await workspaceId(),
        provider: "ZOHO_BIGIN",
        entityType: "CONTACT",
        localEntityId: "r1-local-contact-1",
        externalRecordId: "zoho-contact-2"
      })
    ).rejects.toBeInstanceOf(Prisma.PrismaClientKnownRequestError);

    await expect(
      createExternalRecordMapping({
        workspaceId: await workspaceId(),
        provider: "ZOHO_BIGIN",
        entityType: "CONTACT",
        localEntityId: "r1-local-contact-2",
        externalRecordId: "zoho-contact-1"
      })
    ).rejects.toBeInstanceOf(Prisma.PrismaClientKnownRequestError);

    await expect(
      createExternalRecordMapping({
        workspaceId: await workspaceId(),
        provider: "ZOHO_BIGIN",
        entityType: "LEAD",
        localEntityId: "r1-local-lead-2",
        externalRecordId: "zoho-lead-2",
        idempotencyKey: "r1-idempotency-contact-1"
      })
    ).rejects.toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
  });

  it("records sync success and failure without losing retry history", async () => {
    const mapping = await createExternalRecordMapping({
      workspaceId: await workspaceId(),
      provider: "ZOHO_BIGIN",
      entityType: "DEAL",
      localEntityId: "r1-local-deal-1",
      externalRecordId: "zoho-deal-1"
    });

    const failed = await markMappingFailed({
      id: mapping.id,
      workspaceId: await workspaceId(),
      errorCode: "RATE_LIMITED",
      errorMessage: "Provider rate limit reached"
    });

    expect(failed.syncStatus).toBe("FAILED");
    expect(failed.retryCount).toBe(1);
    expect(failed.lastErrorCode).toBe("RATE_LIMITED");

    const syncedAt = new Date("2026-09-15T01:00:00.000Z");
    const synced = await markMappingSynced({
      id: mapping.id,
      workspaceId: await workspaceId(),
      externalVersion: "version-2",
      externalUpdatedAt: syncedAt,
      syncedAt
    });

    expect(synced.syncStatus).toBe("SYNCED");
    expect(synced.retryCount).toBe(1);
    expect(synced.lastErrorCode).toBeNull();
    expect(synced.externalVersion).toBe("version-2");
  });

  it("isolates identical provider record ids between workspaces", async () => {
    const workspaceA = await workspaceId(workspaceSlugs[0]);
    const workspaceB = await workspaceId(workspaceSlugs[1]);
    const first = await createExternalRecordMapping({
      workspaceId: workspaceA,
      provider: "ZOHO_BIGIN",
      entityType: "LEAD",
      localEntityId: "r1-shared-local",
      externalRecordId: "r1-shared-external"
    });
    const second = await createExternalRecordMapping({
      workspaceId: workspaceB,
      provider: "ZOHO_BIGIN",
      entityType: "LEAD",
      localEntityId: "r1-shared-local",
      externalRecordId: "r1-shared-external"
    });

    await expect(findMappingByExternalRecord({
      workspaceId: workspaceA,
      provider: "ZOHO_BIGIN",
      entityType: "LEAD",
      externalRecordId: "r1-shared-external"
    })).resolves.toMatchObject({ id: first.id, workspaceId: workspaceA });
    await expect(findMappingByExternalRecord({
      workspaceId: workspaceB,
      provider: "ZOHO_BIGIN",
      entityType: "LEAD",
      externalRecordId: "r1-shared-external"
    })).resolves.toMatchObject({ id: second.id, workspaceId: workspaceB });
  });
});
