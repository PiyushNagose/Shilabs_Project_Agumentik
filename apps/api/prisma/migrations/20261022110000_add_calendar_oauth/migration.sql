CREATE TABLE "CalendarOAuthState" (
    "stateHash" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "calendarId" TEXT NOT NULL DEFAULT 'primary',
    "encryptedVerifier" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CalendarOAuthState_pkey" PRIMARY KEY ("stateHash")
);
CREATE INDEX "CalendarOAuthState_workspaceId_userId_idx" ON "CalendarOAuthState"("workspaceId", "userId");
CREATE INDEX "CalendarOAuthState_expiresAt_idx" ON "CalendarOAuthState"("expiresAt");

CREATE TABLE "WorkspaceCalendarCredential" (
    "workspaceId" TEXT NOT NULL,
    "connectedByUserId" TEXT NOT NULL,
    "encryptedRefreshToken" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "calendarId" TEXT NOT NULL DEFAULT 'primary',
    "scope" TEXT NOT NULL,
    "disabledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WorkspaceCalendarCredential_pkey" PRIMARY KEY ("workspaceId")
);
