CREATE TYPE "KnowledgeBaseCategory" AS ENUM (
    'COMPANY',
    'SERVICE',
    'PROPOSAL',
    'SEO',
    'WEB_DESIGN',
    'GENERAL'
);

CREATE TYPE "KnowledgeBaseStatus" AS ENUM (
    'DRAFT',
    'APPROVED',
    'INACTIVE'
);

CREATE TABLE "KnowledgeBaseEntry" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "category" "KnowledgeBaseCategory" NOT NULL,
    "status" "KnowledgeBaseStatus" NOT NULL DEFAULT 'DRAFT',
    "activeVersionId" TEXT,
    "createdByUserId" TEXT,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KnowledgeBaseEntry_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "KnowledgeBaseVersion" (
    "id" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "sourceTitle" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "sourceType" TEXT NOT NULL,
    "correctionOfVersionId" TEXT,
    "createdByUserId" TEXT,
    "approvedByUserId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KnowledgeBaseVersion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "KnowledgeBaseEntry_key_key" ON "KnowledgeBaseEntry"("key");
CREATE INDEX "KnowledgeBaseEntry_category_idx" ON "KnowledgeBaseEntry"("category");
CREATE INDEX "KnowledgeBaseEntry_status_idx" ON "KnowledgeBaseEntry"("status");
CREATE INDEX "KnowledgeBaseEntry_activeVersionId_idx" ON "KnowledgeBaseEntry"("activeVersionId");
CREATE INDEX "KnowledgeBaseEntry_createdByUserId_idx" ON "KnowledgeBaseEntry"("createdByUserId");
CREATE INDEX "KnowledgeBaseEntry_updatedByUserId_idx" ON "KnowledgeBaseEntry"("updatedByUserId");
CREATE INDEX "KnowledgeBaseEntry_createdAt_idx" ON "KnowledgeBaseEntry"("createdAt");
CREATE UNIQUE INDEX "KnowledgeBaseVersion_entryId_version_key" ON "KnowledgeBaseVersion"("entryId", "version");
CREATE INDEX "KnowledgeBaseVersion_entryId_idx" ON "KnowledgeBaseVersion"("entryId");
CREATE INDEX "KnowledgeBaseVersion_correctionOfVersionId_idx" ON "KnowledgeBaseVersion"("correctionOfVersionId");
CREATE INDEX "KnowledgeBaseVersion_createdByUserId_idx" ON "KnowledgeBaseVersion"("createdByUserId");
CREATE INDEX "KnowledgeBaseVersion_approvedByUserId_idx" ON "KnowledgeBaseVersion"("approvedByUserId");
CREATE INDEX "KnowledgeBaseVersion_approvedAt_idx" ON "KnowledgeBaseVersion"("approvedAt");
CREATE INDEX "KnowledgeBaseVersion_createdAt_idx" ON "KnowledgeBaseVersion"("createdAt");

ALTER TABLE "KnowledgeBaseEntry"
ADD CONSTRAINT "KnowledgeBaseEntry_createdByUserId_fkey"
FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "KnowledgeBaseEntry"
ADD CONSTRAINT "KnowledgeBaseEntry_updatedByUserId_fkey"
FOREIGN KEY ("updatedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "KnowledgeBaseVersion"
ADD CONSTRAINT "KnowledgeBaseVersion_entryId_fkey"
FOREIGN KEY ("entryId") REFERENCES "KnowledgeBaseEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "KnowledgeBaseVersion"
ADD CONSTRAINT "KnowledgeBaseVersion_correctionOfVersionId_fkey"
FOREIGN KEY ("correctionOfVersionId") REFERENCES "KnowledgeBaseVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "KnowledgeBaseVersion"
ADD CONSTRAINT "KnowledgeBaseVersion_createdByUserId_fkey"
FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "KnowledgeBaseVersion"
ADD CONSTRAINT "KnowledgeBaseVersion_approvedByUserId_fkey"
FOREIGN KEY ("approvedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
