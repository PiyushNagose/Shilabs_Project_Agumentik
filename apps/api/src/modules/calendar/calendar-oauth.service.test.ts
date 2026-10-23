import { createHash } from "node:crypto";
import type { CalendarOAuthState, WorkspaceCalendarCredential } from "@prisma/client";
import { OAuth2Client, type GetTokenOptions, type Credentials } from "google-auth-library";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthenticatedUser } from "../auth/auth.types.js";
import { decryptCalendarSecret, encryptCalendarSecret } from "./calendar-oauth.crypto.js";
import {
  CALENDAR_OAUTH_SCOPES, calendarOAuthRedirect, completeCalendarOAuth,
  isCalendarOAuthEnabled, resolveWorkspaceCalendarConfig, startCalendarOAuth
} from "./calendar-oauth.service.js";
import { getCalendarAvailability } from "./calendar.service.js";
import { GoogleCalendarProvider } from "./calendar.provider.js";

const db = vi.hoisted(() => {
  const delegates = {
    calendarOAuthState: { create: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn() },
    workspaceCalendarCredential: { findUnique: vi.fn(), upsert: vi.fn() },
    integrationAccount: { findUnique: vi.fn(), upsert: vi.fn() },
    workspaceMember: { findFirst: vi.fn() }, user: { findUnique: vi.fn() }
  };
  return { ...delegates, $transaction: vi.fn(async (operation: (tx: typeof delegates) => Promise<unknown>) => operation(delegates)) };
});
vi.mock("../../shared/prisma.js", () => ({ prisma: db }));

const env: NodeJS.ProcessEnv = {
  GOOGLE_CALENDAR_CLIENT_ID: "test-client", GOOGLE_CALENDAR_CLIENT_SECRET: "test-client-secret",
  GOOGLE_CALENDAR_REDIRECT_URI: "http://localhost:4010/api/calendar/oauth/google/callback",
  WEB_ORIGIN: "http://localhost:5174", CALENDAR_OAUTH_ENCRYPTION_KEY: "ab".repeat(32),
  CALENDAR_PROVIDER: "google", GOOGLE_CALENDAR_REFRESH_TOKEN: "shared-env-token",
  GOOGLE_CALENDAR_ID: "shared@example.test"
};
const actor: AuthenticatedUser = {
  id: "manager-a", email: "manager@example.test", firstName: "Manager", lastName: "A",
  role: "ADMIN", activeWorkspaceRole: "SALES_MANAGER", status: "ACTIVE",
  activeWorkspaceId: "workspace-a", createdAt: new Date(), updatedAt: new Date()
};
let stateRecord: CalendarOAuthState | null;
let credential: WorkspaceCalendarCredential | null;
const exchangeToken = vi.fn<(options: GetTokenOptions) => Promise<{ tokens: Credentials; res: null }>>();

function storedCredential(workspaceId = "workspace-a"): WorkspaceCalendarCredential {
  return { workspaceId, connectedByUserId: actor.id, clientId: "test-client", calendarId: "primary",
    encryptedRefreshToken: encryptCalendarSecret("saved-workspace-token", `calendar:${workspaceId}`, env),
    scope: CALENDAR_OAUTH_SCOPES.join(" "), disabledAt: null, createdAt: new Date(), updatedAt: new Date() };
}

async function begin(): Promise<string> {
  return new URL((await startCalendarOAuth(actor, "primary", env)).authorizationUrl).searchParams.get("state") ?? "";
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  stateRecord = null;
  credential = null;
  db.workspaceMember.findFirst.mockResolvedValue({ id: "member-a" });
  db.integrationAccount.findUnique.mockResolvedValue(null);
  db.calendarOAuthState.create.mockImplementation(({ data }: { data: CalendarOAuthState }) => {
    stateRecord = { ...data, consumedAt: null, createdAt: new Date() };
    return Promise.resolve(stateRecord);
  });
  db.calendarOAuthState.findUnique.mockImplementation(() => Promise.resolve(stateRecord));
  db.calendarOAuthState.updateMany.mockImplementation(({ where, data }: {
    where: { consumedAt: null | { not: null }; expiresAt: { gt: Date } }; data: { consumedAt: Date }
  }) => {
    if (!stateRecord || stateRecord.expiresAt <= where.expiresAt.gt ||
      (where.consumedAt === null ? stateRecord.consumedAt !== null : stateRecord.consumedAt === null)) {
      return Promise.resolve({ count: 0 });
    }
    stateRecord.consumedAt = data.consumedAt;
    return Promise.resolve({ count: 1 });
  });
  db.workspaceCalendarCredential.findUnique.mockImplementation(({ where }: { where: { workspaceId: string } }) =>
    Promise.resolve(credential?.workspaceId === where.workspaceId ? credential : null));
  db.workspaceCalendarCredential.upsert.mockResolvedValue({});
  db.integrationAccount.upsert.mockResolvedValue({});
  vi.spyOn(OAuth2Client.prototype, "getToken");
  Object.defineProperty(OAuth2Client.prototype, "getToken", { value: exchangeToken, configurable: true });
  exchangeToken.mockResolvedValue({
    tokens: { refresh_token: "new-refresh-secret", access_token: "ephemeral-access-secret", scope: CALENDAR_OAUTH_SCOPES.join(" ") }, res: null
  });
});

describe("Google Calendar workspace OAuth", () => {
  it("binds encrypted PKCE and a hashed expiring state to an active workspace manager", async () => {
    const result = await startCalendarOAuth(actor, "calendar@example.test", env);
    const url = new URL(result.authorizationUrl);
    const state = url.searchParams.get("state") ?? "";
    expect(stateRecord).toMatchObject({ workspaceId: "workspace-a", userId: actor.id, calendarId: "calendar@example.test",
      stateHash: createHash("sha256").update(state).digest("hex"), consumedAt: null });
    const verifier = decryptCalendarSecret(stateRecord?.encryptedVerifier ?? "", `state:${stateRecord?.stateHash ?? ""}`, env);
    expect(url.searchParams.get("code_challenge")).toBe(createHash("sha256").update(verifier).digest("base64url"));
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("scope")?.split(" ")).toEqual(CALENDAR_OAUTH_SCOPES);
    expect(JSON.stringify(result)).not.toContain(verifier);
    expect(JSON.stringify(result)).not.toContain(env.GOOGLE_CALENDAR_CLIENT_SECRET);
    expect(stateRecord?.expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(stateRecord?.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 600_000);
    expect(db.workspaceMember.findFirst.mock.calls[0]?.[0]).toMatchObject({ where: {
      workspaceId: "workspace-a", userId: actor.id, status: "ACTIVE", user: { status: "ACTIVE" }, workspace: { status: "ACTIVE" }
    } });
  });

  it("rejects representatives, missing workspace and revoked manager membership", async () => {
    await expect(startCalendarOAuth({ ...actor, activeWorkspaceRole: "SALES_REP" }, "primary", env)).rejects.toMatchObject({ statusCode: 403 });
    await expect(startCalendarOAuth({ ...actor, activeWorkspaceId: undefined }, "primary", env)).rejects.toMatchObject({ statusCode: 403 });
    db.workspaceMember.findFirst.mockResolvedValue(null);
    await expect(startCalendarOAuth(actor, "primary", env)).rejects.toMatchObject({ statusCode: 403 });
    expect(db.calendarOAuthState.create).not.toHaveBeenCalled();
  });

  it("fails truthfully without encryption, client or trusted redirect configuration", async () => {
    for (const missing of ["CALENDAR_OAUTH_ENCRYPTION_KEY", "GOOGLE_CALENDAR_CLIENT_SECRET", "GOOGLE_CALENDAR_REDIRECT_URI", "WEB_ORIGIN"]) {
      const incomplete = { ...env, [missing]: "" };
      expect(isCalendarOAuthEnabled(incomplete)).toBe(false);
      await expect(startCalendarOAuth(actor, "primary", incomplete)).rejects.toMatchObject({ statusCode: 503 });
    }
    expect(isCalendarOAuthEnabled({ ...env, WEB_ORIGIN: "https://app.example.test@evil.test/path" })).toBe(false);
    expect(isCalendarOAuthEnabled(env)).toBe(true);
    expect(db.calendarOAuthState.create).not.toHaveBeenCalled();
  });

  it("exchanges once, stores only encrypted refresh credentials, and rejects replay", async () => {
    const state = await begin();
    await expect(completeCalendarOAuth({ state, code: "authorization-code" }, env)).resolves.toBe("connected");
    expect(exchangeToken.mock.calls[0]?.[0]).toMatchObject({
      code: "authorization-code", redirect_uri: env.GOOGLE_CALENDAR_REDIRECT_URI,
    });
    expect(exchangeToken.mock.calls[0]?.[0].codeVerifier).toBeTypeOf("string");
    const saved = db.workspaceCalendarCredential.upsert.mock.calls[0]?.[0] as { create: WorkspaceCalendarCredential };
    expect(decryptCalendarSecret(saved.create.encryptedRefreshToken, "calendar:workspace-a", env)).toBe("new-refresh-secret");
    expect(JSON.stringify(db.workspaceCalendarCredential.upsert.mock.calls)).not.toMatch(/new-refresh-secret|ephemeral-access-secret/);
    await expect(completeCalendarOAuth({ state, code: "authorization-code" }, env)).rejects.toThrow("expired or already used");
    expect(exchangeToken).toHaveBeenCalledTimes(1);
  });

  it("expires state, rejects unknown state, and consumes cancellation without exchanging codes", async () => {
    const state = await begin();
    if (stateRecord) stateRecord.expiresAt = new Date(0);
    await expect(completeCalendarOAuth({ state, code: "code" }, env)).rejects.toThrow("expired or already used");
    stateRecord = null;
    await expect(completeCalendarOAuth({ state, code: "code" }, env)).rejects.toThrow("expired or already used");
    const nextState = await begin();
    await expect(completeCalendarOAuth({ state: nextState, error: "access_denied" }, env)).resolves.toBe("cancelled");
    await expect(completeCalendarOAuth({ state: nextState, code: "code" }, env)).rejects.toThrow("expired or already used");
    expect(exchangeToken).not.toHaveBeenCalled();
  });

  it("rechecks active manager membership at callback and before persistence", async () => {
    const state = await begin();
    db.workspaceMember.findFirst.mockResolvedValue(null);
    await expect(completeCalendarOAuth({ state, code: "code" }, env)).rejects.toMatchObject({ statusCode: 403 });
    expect(exchangeToken).not.toHaveBeenCalled();
    db.workspaceMember.findFirst.mockResolvedValue({ id: "member-a" });
    const nextState = await begin();
    db.workspaceMember.findFirst.mockResolvedValueOnce({ id: "member-a" }).mockResolvedValueOnce(null);
    await expect(completeCalendarOAuth({ state: nextState, code: "code" }, env)).rejects.toMatchObject({ statusCode: 403 });
    expect(db.workspaceCalendarCredential.upsert).not.toHaveBeenCalled();
  });

  it("preserves an existing refresh token when Google omits a replacement", async () => {
    credential = storedCredential();
    exchangeToken.mockResolvedValue({ tokens: { scope: CALENDAR_OAUTH_SCOPES.join(" ") }, res: null });
    await completeCalendarOAuth({ state: await begin(), code: "code" }, env);
    expect(db.workspaceCalendarCredential.upsert.mock.calls[0]?.[0]).toMatchObject({ update: {
      encryptedRefreshToken: credential.encryptedRefreshToken
    } });
  });

  it("requires a refresh token for a fresh workspace and both permission scopes", async () => {
    exchangeToken.mockResolvedValue({ tokens: { scope: CALENDAR_OAUTH_SCOPES.join(" ") }, res: null });
    await expect(completeCalendarOAuth({ state: await begin(), code: "code" }, env)).rejects.toThrow("did not return a refresh token");
    exchangeToken.mockResolvedValue({ tokens: { refresh_token: "secret", scope: CALENDAR_OAUTH_SCOPES[0] }, res: null });
    await expect(completeCalendarOAuth({ state: await begin(), code: "code" }, env)).rejects.toThrow("meeting-write permissions");
    expect(db.workspaceCalendarCredential.upsert).not.toHaveBeenCalled();
  });

  it("cannot restore a connection invalidated during the token exchange", async () => {
    const state = await begin();
    exchangeToken.mockImplementation(() => {
      stateRecord = null;
      return Promise.resolve({ tokens: { refresh_token: "new", scope: CALENDAR_OAUTH_SCOPES.join(" ") }, res: null });
    });
    await expect(completeCalendarOAuth({ state, code: "code" }, env)).rejects.toThrow("invalidated");
    expect(db.workspaceCalendarCredential.upsert).not.toHaveBeenCalled();
  });

  it("sanitizes provider errors and redirects only to configured WEB_ORIGIN", async () => {
    exchangeToken.mockRejectedValue(new Error("client-secret code=secret-code refresh_token=secret"));
    await expect(completeCalendarOAuth({ state: await begin(), code: "code" }, env)).rejects.toThrow("Google Calendar authorization failed; reconnect to try again");
    expect(calendarOAuthRedirect("failed", env)).toBe("http://localhost:5174/integrations?calendarOAuth=failed");
    expect(() => calendarOAuthRedirect("failed", { ...env, WEB_ORIGIN: "" })).toThrow("redirect configuration");
  });

  it("uses workspace credentials, isolates tenants, and preserves configured environment fallback for never-connected workspaces", async () => {
    credential = storedCredential();
    await expect(resolveWorkspaceCalendarConfig("workspace-a", env)).resolves.toMatchObject({
      provider: "google", google: { refreshToken: "saved-workspace-token", calendarId: "primary", scope: CALENDAR_OAUTH_SCOPES.join(" ") }
    });
    await expect(resolveWorkspaceCalendarConfig("workspace-b", env)).resolves.toMatchObject({ google: { refreshToken: "shared-env-token" } });
    await expect(resolveWorkspaceCalendarConfig("", env)).rejects.toMatchObject({ statusCode: 403 });
    credential = { ...storedCredential("workspace-b"), workspaceId: "workspace-a" };
    await expect(resolveWorkspaceCalendarConfig("workspace-a", env)).rejects.toThrow("cannot be decrypted");
  });

  it("blocks disabled and disconnected credentials and never falls back after decryption or client failure", async () => {
    credential = { ...storedCredential(), disabledAt: new Date(), encryptedRefreshToken: "" };
    await expect(resolveWorkspaceCalendarConfig("workspace-a", env)).resolves.toMatchObject({ provider: "none" });
    credential = storedCredential();
    db.integrationAccount.findUnique.mockResolvedValue({ status: "DISABLED" });
    await expect(resolveWorkspaceCalendarConfig("workspace-a", env)).resolves.toMatchObject({ provider: "none" });
    db.integrationAccount.findUnique.mockResolvedValue(null);
    await expect(resolveWorkspaceCalendarConfig("workspace-a", { ...env, CALENDAR_OAUTH_ENCRYPTION_KEY: "" })).rejects.toMatchObject({ statusCode: 503 });
    await expect(resolveWorkspaceCalendarConfig("workspace-a", { ...env, GOOGLE_CALENDAR_CLIENT_ID: "another-client" })).rejects.toThrow("configuration has changed");
    credential.encryptedRefreshToken += "tampered";
    await expect(resolveWorkspaceCalendarConfig("workspace-a", env)).rejects.toThrow("cannot be decrypted");
  });

  it("rejects manager access to owners outside the active workspace before resolving secrets", async () => {
    db.workspaceMember.findFirst.mockResolvedValue(null);
    await expect(getCalendarAvailability(actor, {
      ownerUserId: "foreign-owner", timeZone: "Asia/Kolkata", windowStart: new Date(), windowEnd: new Date(Date.now() + 3600_000), slotMinutes: 30
    })).rejects.toMatchObject({ statusCode: 404 });
    expect(db.workspaceMember.findFirst.mock.calls[0]?.[0]).toMatchObject({ where: { workspaceId: "workspace-a", userId: "foreign-owner", status: "ACTIVE" } });
    expect(db.workspaceCalendarCredential.findUnique).not.toHaveBeenCalled();
  });

  it("reports missing configured meeting-write scope and rejects a token with only freebusy permission", async () => {
    const config = await resolveWorkspaceCalendarConfig("workspace-a", { ...env, GOOGLE_CALENDAR_SCOPE: CALENDAR_OAUTH_SCOPES[0] });
    const transport = vi.fn().mockResolvedValue(Response.json({ access_token: "access", expires_in: 3600, scope: CALENDAR_OAUTH_SCOPES[0] }));
    await expect(new GoogleCalendarProvider(config, transport).getHealth()).resolves.toMatchObject({
      status: "NOT_CONFIGURED", missingConfig: ["GOOGLE_CALENDAR_SCOPE_EVENTS"]
    });
    expect(transport).not.toHaveBeenCalled();
    config.google.scope = CALENDAR_OAUTH_SCOPES.join(" ");
    const health = await new GoogleCalendarProvider(config, transport).getHealth();
    expect(health.status).toBe("ERROR");
    expect(health.lastError).toContain("calendar.events scope");
  });
});
