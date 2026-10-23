import { createHash, randomBytes } from "node:crypto";
import { CodeChallengeMethod, OAuth2Client, type Credentials } from "google-auth-library";
import { getCalendarConfig, type CalendarConfig } from "@shilabs/shared-config";
import { AppError } from "../../shared/errors.js";
import { prisma } from "../../shared/prisma.js";
import type { AuthenticatedUser } from "../auth/auth.types.js";
import { isWorkspaceManager } from "../authorization/workspace-permissions.js";
import { calendarEncryptionKey, decryptCalendarSecret, encryptCalendarSecret } from "./calendar-oauth.crypto.js";

export const CALENDAR_OAUTH_SCOPES = [
  "https://www.googleapis.com/auth/calendar.freebusy",
  "https://www.googleapis.com/auth/calendar.events"
];
const managerRoles = ["OWNER", "ADMIN", "SALES_MANAGER"] as const;

function configuredUrl(value: string | undefined, originOnly = false): URL {
  try {
    const url = new URL(value ?? "");
    if (url.username || url.password || url.hash || url.search ||
      !(url.protocol === "https:" || (url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))) ||
      (originOnly && url.pathname !== "/")) throw new Error();
    return url;
  } catch {
    throw new AppError(503, "PROVIDER_ERROR", "Calendar OAuth redirect configuration is missing or invalid");
  }
}

function oauthConfig(env: NodeJS.ProcessEnv) {
  calendarEncryptionKey(env);
  if (!env.GOOGLE_CALENDAR_CLIENT_ID?.trim() || !env.GOOGLE_CALENDAR_CLIENT_SECRET?.trim()) {
    throw new AppError(503, "PROVIDER_ERROR", "Google Calendar OAuth client credentials are not configured");
  }
  const redirectUri = configuredUrl(env.GOOGLE_CALENDAR_REDIRECT_URI).href;
  configuredUrl(env.WEB_ORIGIN, true);
  return { clientId: env.GOOGLE_CALENDAR_CLIENT_ID, clientSecret: env.GOOGLE_CALENDAR_CLIENT_SECRET, redirectUri };
}

export function isCalendarOAuthEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  try { oauthConfig(env); return true; } catch { return false; }
}

export function calendarOAuthRedirect(status: "connected" | "cancelled" | "failed", env: NodeJS.ProcessEnv = process.env): string {
  const target = new URL("/integrations", configuredUrl(env.WEB_ORIGIN, true));
  target.searchParams.set("calendarOAuth", status);
  return target.href;
}

async function requireManager(workspaceId: string, userId: string, db: Pick<typeof prisma, "workspaceMember"> = prisma): Promise<void> {
  const member = await db.workspaceMember.findFirst({
    where: {
      workspaceId, userId, status: "ACTIVE", role: { in: [...managerRoles] },
      user: { status: "ACTIVE" }, workspace: { status: "ACTIVE" }
    }, select: { id: true }
  });
  if (!member) throw new AppError(403, "AUTHORIZATION_ERROR", "Active workspace manager membership is required");
}

export async function startCalendarOAuth(actor: AuthenticatedUser, calendarId = "primary", env: NodeJS.ProcessEnv = process.env): Promise<{ authorizationUrl: string }> {
  if (!actor.activeWorkspaceId || !isWorkspaceManager(actor)) {
    throw new AppError(403, "AUTHORIZATION_ERROR", "Calendar reconnect requires workspace manager access");
  }
  await requireManager(actor.activeWorkspaceId, actor.id);
  if (calendarId !== "primary" && !/^[^\s@]{1,128}@[^\s@]{1,128}\.[^\s@]{1,64}$/.test(calendarId)) {
    throw new AppError(400, "VALIDATION_ERROR", "Calendar ID must be primary or an email address");
  }
  const config = oauthConfig(env);
  const client = new OAuth2Client(config);
  const { codeVerifier, codeChallenge } = await client.generateCodeVerifierAsync();
  const state = randomBytes(32).toString("base64url");
  const stateHash = createHash("sha256").update(state).digest("hex");
  await prisma.calendarOAuthState.create({ data: {
    stateHash, workspaceId: actor.activeWorkspaceId, userId: actor.id, calendarId,
    encryptedVerifier: encryptCalendarSecret(codeVerifier, `state:${stateHash}`, env),
    expiresAt: new Date(Date.now() + 10 * 60 * 1000)
  } });
  return { authorizationUrl: client.generateAuthUrl({
    access_type: "offline", prompt: "consent", scope: CALENDAR_OAUTH_SCOPES,
    state, code_challenge: codeChallenge, code_challenge_method: CodeChallengeMethod.S256
  }) };
}

export async function completeCalendarOAuth(input: { state?: string; code?: string; error?: string }, env: NodeJS.ProcessEnv = process.env): Promise<"connected" | "cancelled"> {
  const config = oauthConfig(env);
  if (!input.state || !/^[\w-]{43}$/.test(input.state)) throw new AppError(400, "VALIDATION_ERROR", "Invalid calendar authorization state");
  const stateHash = createHash("sha256").update(input.state).digest("hex");
  const state = await prisma.calendarOAuthState.findUnique({ where: { stateHash } });
  if (!state) throw new AppError(400, "VALIDATION_ERROR", "Calendar authorization state is expired or already used");
  // Atomic claim prevents two callbacks from exchanging or persisting the same authorization.
  const claimed = await prisma.calendarOAuthState.updateMany({
    where: { stateHash, consumedAt: null, expiresAt: { gt: new Date() } }, data: { consumedAt: new Date() }
  });
  if (claimed.count !== 1) throw new AppError(400, "VALIDATION_ERROR", "Calendar authorization state is expired or already used");
  await requireManager(state.workspaceId, state.userId);
  if (input.error) return "cancelled";
  if (!input.code || input.code.length > 4096) throw new AppError(400, "VALIDATION_ERROR", "Calendar authorization code is missing");
  const client = new OAuth2Client(config);
  let tokens: Credentials;
  try {
    ({ tokens } = await client.getToken({ code: input.code,
      codeVerifier: decryptCalendarSecret(state.encryptedVerifier, `state:${stateHash}`, env),
      redirect_uri: config.redirectUri
    }));
  } catch {
    // Provider errors can contain authorization codes, headers and client credentials.
    throw new AppError(502, "PROVIDER_ERROR", "Google Calendar authorization failed; reconnect to try again");
  }
  const scope = tokens.scope ?? "";
  if (!CALENDAR_OAUTH_SCOPES.every((required) => scope.split(/\s+/).includes(required))) {
    throw new AppError(400, "PROVIDER_ERROR", "Google Calendar requires availability and meeting-write permissions");
  }
  await prisma.$transaction(async (tx) => {
    // Hold the state row until commit so disable/disconnect cannot race a reconnect.
    const stillValid = await tx.calendarOAuthState.updateMany({
      where: { stateHash, consumedAt: { not: null }, expiresAt: { gt: new Date() } },
      data: { consumedAt: new Date() }
    });
    if (stillValid.count !== 1) throw new AppError(400, "VALIDATION_ERROR", "Calendar authorization was invalidated; reconnect again");
    await requireManager(state.workspaceId, state.userId, tx);
    const previous = await tx.workspaceCalendarCredential.findUnique({ where: { workspaceId: state.workspaceId } });
    let encryptedRefreshToken: string;
    if (tokens.refresh_token) {
      encryptedRefreshToken = encryptCalendarSecret(tokens.refresh_token, `calendar:${state.workspaceId}`, env);
    } else if (previous?.clientId === config.clientId && previous.calendarId === state.calendarId) {
      decryptCalendarSecret(previous.encryptedRefreshToken, `calendar:${state.workspaceId}`, env);
      encryptedRefreshToken = previous.encryptedRefreshToken;
    } else {
      throw new AppError(400, "PROVIDER_ERROR", "Google did not return a refresh token; revoke access and reconnect Google Calendar");
    }
    const data = { connectedByUserId: state.userId, encryptedRefreshToken, clientId: config.clientId,
      calendarId: state.calendarId, scope, disabledAt: null };
    await tx.workspaceCalendarCredential.upsert({ where: { workspaceId: state.workspaceId },
      create: { workspaceId: state.workspaceId, ...data }, update: data });
    const connection = { status: "CONNECTED" as const, healthStatus: "UNKNOWN" as const,
      disabledAt: null, lastCheckedAt: null, lastHealthyAt: null, lastError: null,
      secretRef: "db:workspace-calendar", publicConfig: { catalogKey: "google-calendar", category: "CALENDAR" } };
    await tx.integrationAccount.upsert({ where: { workspaceId_provider_key: {
      workspaceId: state.workspaceId, provider: "GOOGLE_CALENDAR", key: "default"
    } }, create: { workspaceId: state.workspaceId, provider: "GOOGLE_CALENDAR", key: "default",
      displayName: "Google Calendar", ...connection }, update: connection });
  });
  return "connected";
}

export async function resolveWorkspaceCalendarConfig(workspaceId: string, env: NodeJS.ProcessEnv = process.env): Promise<CalendarConfig> {
  if (!workspaceId) throw new AppError(403, "AUTHORIZATION_ERROR", "Active workspace required");
  const config = getCalendarConfig(env);
  const [credential, connection] = await Promise.all([
    prisma.workspaceCalendarCredential.findUnique({ where: { workspaceId } }),
    prisma.integrationAccount.findUnique({ where: { workspaceId_provider_key: { workspaceId, provider: "GOOGLE_CALENDAR", key: "default" } } })
  ]);
  if (credential?.disabledAt || connection?.status === "DISABLED") return { ...config, provider: "none" };
  if (!credential) return config;
  if (!config.google.clientId || !config.google.clientSecret || credential.clientId !== config.google.clientId) {
    throw new AppError(503, "PROVIDER_ERROR", "Saved Google Calendar OAuth client configuration has changed; reconnect Google Calendar");
  }
  return { ...config, provider: "google", google: { ...config.google,
    refreshToken: decryptCalendarSecret(credential.encryptedRefreshToken, `calendar:${workspaceId}`, env),
    calendarId: credential.calendarId, scope: credential.scope
  } };
}
