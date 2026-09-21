import request from "supertest";
import { UserRole, UserStatus } from "@prisma/client";
import type { ApprovedKnowledgeDto, AuthResponse, KnowledgeBaseEntryDto } from "@shilabs/shared-types";
import { createApp } from "../../app.js";
import { prisma } from "../../shared/prisma.js";
import { hashPassword } from "../auth/auth.service.js";

const app = createApp();
const adminEmail = "r9-kb-admin@example.local";
const repEmail = "r9-kb-rep@example.local";
const password = "CorrectHorse123!";

async function login(email: string): Promise<string> {
  const response = await request(app).post("/api/auth/login").send({ email, password }).expect(200);
  return (response.body as unknown as AuthResponse).accessToken;
}

async function cleanup(): Promise<void> {
  await prisma.authSession.deleteMany({
    where: { user: { email: { in: [adminEmail, repEmail] } } }
  });
  await prisma.knowledgeBaseVersion.deleteMany({
    where: { entry: { key: { startsWith: "r9-" } } }
  });
  await prisma.knowledgeBaseEntry.deleteMany({ where: { key: { startsWith: "r9-" } } });
  await prisma.auditEvent.deleteMany({
    where: {
      entityType: "KnowledgeBaseEntry"
    }
  });
  await prisma.user.deleteMany({ where: { email: { in: [adminEmail, repEmail] } } });
}

async function seedUsers(): Promise<void> {
  const passwordHash = await hashPassword(password);
  await prisma.user.createMany({
    data: [
      {
        email: adminEmail,
        passwordHash,
        firstName: "KB",
        lastName: "Admin",
        role: UserRole.ADMIN,
        status: UserStatus.ACTIVE
      },
      {
        email: repEmail,
        passwordHash,
        firstName: "KB",
        lastName: "Rep",
        role: UserRole.SALES_REP,
        status: UserStatus.ACTIVE
      }
    ]
  });
}

describe("R9 knowledge base API", () => {
  beforeEach(async () => {
    await cleanup();
    await seedUsers();
  }, 45000);

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  }, 45000);

  it("keeps draft knowledge out of approved retrieval", async () => {
    const adminToken = await login(adminEmail);
    const repToken = await login(repEmail);

    await request(app)
      .post("/api/knowledge-base")
      .set("Authorization", `Bearer ${repToken}`)
      .send({
        key: "r9-draft-service",
        title: "Draft Service",
        category: "SERVICE",
        content: "This draft service detail is long enough for validation.",
        sourceTitle: "Internal Draft",
        sourceType: "internal"
      })
      .expect(403);

    const createResponse = await request(app)
      .post("/api/knowledge-base")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        key: "r9-draft-service",
        title: "Draft Service",
        category: "SERVICE",
        content: "This draft service detail is long enough for validation.",
        sourceTitle: "Internal Draft",
        sourceType: "internal",
        approve: false
      })
      .expect(201);
    const entry = createResponse.body as unknown as KnowledgeBaseEntryDto;

    expect(entry.status).toBe("DRAFT");
    expect(entry.activeVersion).toBeNull();

    const approvedResponse = await request(app)
      .get("/api/knowledge-base/approved")
      .set("Authorization", `Bearer ${repToken}`)
      .expect(200);
    const approved = approvedResponse.body as unknown as ApprovedKnowledgeDto[];

    expect(approved.some((item) => item.key === "r9-draft-service")).toBe(false);
  }, 45000);

  it("returns only approved active versions and preserves correction history", async () => {
    const adminToken = await login(adminEmail);
    const repToken = await login(repEmail);

    const createResponse = await request(app)
      .post("/api/knowledge-base")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        key: "r9-approved-service",
        title: "Approved Service",
        category: "SERVICE",
        content: "Approved service knowledge from the Shilabs service catalog.",
        sourceTitle: "Service Catalog",
        sourceUrl: "https://shilabs.digital",
        sourceType: "website",
        approve: true
      })
      .expect(201);
    const created = createResponse.body as unknown as KnowledgeBaseEntryDto;

    const correctionResponse = await request(app)
      .post(`/api/knowledge-base/${created.id}/corrections`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        content: "Corrected approved service knowledge from the Shilabs service catalog.",
        sourceTitle: "Service Catalog Update",
        sourceUrl: "https://shilabs.digital",
        sourceType: "website",
        reason: "Human correction after service wording review",
        approve: true
      })
      .expect(200);
    const corrected = correctionResponse.body as unknown as KnowledgeBaseEntryDto;

    expect(corrected.status).toBe("APPROVED");
    expect(corrected.versions).toHaveLength(2);
    expect(corrected.activeVersion?.version).toBe(2);
    expect(corrected.activeVersion?.correctionOfVersionId).toBe(created.activeVersionId);

    const approvedResponse = await request(app)
      .get("/api/knowledge-base/approved?category=SERVICE&q=Corrected")
      .set("Authorization", `Bearer ${repToken}`)
      .expect(200);
    const approved = approvedResponse.body as unknown as ApprovedKnowledgeDto[];

    expect(approved).toHaveLength(1);
    expect(approved[0]?.key).toBe("r9-approved-service");
    expect(approved[0]?.version).toBe(2);
    await prisma.auditEvent.findFirstOrThrow({
      where: { entityType: "KnowledgeBaseEntry", action: "KNOWLEDGE_ENTRY_CORRECTED" }
    });
  }, 45000);

  it("removes inactive entries from approved retrieval", async () => {
    const adminToken = await login(adminEmail);
    const repToken = await login(repEmail);

    const createResponse = await request(app)
      .post("/api/knowledge-base")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        key: "r9-inactive-policy",
        title: "Inactive Policy",
        category: "GENERAL",
        content: "Approved policy knowledge that will be inactivated for test coverage.",
        sourceTitle: "Policy Doc",
        sourceType: "internal",
        approve: true
      })
      .expect(201);
    const entry = createResponse.body as unknown as KnowledgeBaseEntryDto;

    await request(app)
      .patch(`/api/knowledge-base/${entry.id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "INACTIVE" })
      .expect(200);

    const approvedResponse = await request(app)
      .get("/api/knowledge-base/approved?q=inactive")
      .set("Authorization", `Bearer ${repToken}`)
      .expect(200);
    const approved = approvedResponse.body as unknown as ApprovedKnowledgeDto[];

    expect(approved.some((item) => item.key === "r9-inactive-policy")).toBe(false);
  }, 45000);
});
