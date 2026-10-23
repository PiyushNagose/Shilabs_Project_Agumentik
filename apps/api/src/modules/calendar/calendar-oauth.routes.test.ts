import express from "express";
import request from "supertest";
import { parseSetCookie } from "cookie";
import { UserRole, UserStatus, WorkspaceRole } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { errorHandler } from "../../middleware/error.middleware.js";
import { verifyAccessToken } from "../auth/auth.service.js";
import { resolveWorkspaceContext } from "../workspaces/workspace.service.js";
import { calendarOAuthRedirect, completeCalendarOAuth, startCalendarOAuth } from "./calendar-oauth.service.js";
import { calendarRoutes } from "./calendar.routes.js";
import { encryptCalendarSecret } from "./calendar-oauth.crypto.js";

vi.mock("../auth/auth.service.js", () => ({ verifyAccessToken: vi.fn() }));
vi.mock("../workspaces/workspace.service.js", () => ({ resolveWorkspaceContext: vi.fn() }));
vi.mock("./calendar.controller.js", () => ({
  getCalendarAvailabilityController: vi.fn(), getCalendarHealthController: vi.fn()
}));
vi.mock("./calendar-oauth.service.js", () => ({
  startCalendarOAuth: vi.fn(), completeCalendarOAuth: vi.fn(),
  calendarOAuthRedirect: vi.fn(), isCalendarOAuthEnabled: vi.fn()
}));

const callbackPath = "/api/calendar/oauth/google/callback";
const startPath = "/api/calendar/oauth/google/start";
const state = "a".repeat(43);
const authorizationUrl = `https://accounts.google.com/o/oauth2/v2/auth?state=${state}`;
const app = express();
app.set("trust proxy", true);
app.use(express.json());
app.use("/api/calendar", calendarRoutes);
app.use(errorHandler);

function responseCookie(response: request.Response) {
  const cookies: unknown = response.headers["set-cookie"];
  if (!Array.isArray(cookies) || typeof cookies[0] !== "string") {
    throw new Error("Expected an OAuth state cookie");
  }
  return parseSetCookie(cookies[0]);
}

describe("Google OAuth browser binding without database access", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("GOOGLE_CALENDAR_REDIRECT_URI", `http://localhost:4000${callbackPath}`);
    vi.stubEnv("WEB_ORIGIN", "http://localhost:5173");
    vi.stubEnv("CALENDAR_OAUTH_ENCRYPTION_KEY", "a".repeat(64));
    vi.mocked(verifyAccessToken).mockResolvedValue({
      id: "manager-1", email: "manager@example.test", firstName: "Calendar", lastName: "Manager",
      role: UserRole.SALES_MANAGER, status: UserStatus.ACTIVE,
      createdAt: new Date(), updatedAt: new Date()
    });
    vi.mocked(resolveWorkspaceContext).mockResolvedValue({
      workspaceId: "workspace-1", workspaceName: "Sales", memberId: "member-1", role: WorkspaceRole.SALES_MANAGER
    });
    vi.mocked(startCalendarOAuth).mockResolvedValue({ authorizationUrl });
    vi.mocked(completeCalendarOAuth).mockResolvedValue("connected");
    vi.mocked(calendarOAuthRedirect).mockImplementation((status) => `http://localhost:5173/integrations?calendarOAuth=${status}`);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("sets a short-lived HttpOnly Lax host cookie on authenticated start for localhost", async () => {
    const response = await request(app).post(startPath)
      .set("Authorization", "Bearer manager").set("Origin", "http://localhost:5173")
      .send({ calendarId: "primary" }).expect(200);
    expect(responseCookie(response)).toMatchObject({
      name: "calendar_oauth_state", value: state, httpOnly: true, sameSite: "lax", path: callbackPath, maxAge: 600
    });
    expect(responseCookie(response).secure).toBeUndefined();
    expect(responseCookie(response).domain).toBeUndefined();
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(startCalendarOAuth).toHaveBeenCalledWith(expect.objectContaining({ activeWorkspaceId: "workspace-1" }), "primary");
  });

  it("does not set a cookie or start OAuth for an unauthenticated caller", async () => {
    const response = await request(app).post(startPath).send({}).expect(401);
    expect(response.headers["set-cookie"]).toBeUndefined();
    expect(startCalendarOAuth).not.toHaveBeenCalled();
  });

  it("launches from a top-level form without relying on cross-site fetch cookies", async () => {
    const started = await request(app).post(startPath).set("Authorization", "Bearer manager").send({}).expect(200);
    const { launchToken } = started.body as { launchToken: string };
    const browser = request.agent(app);
    const launch = await browser.post("/api/calendar/oauth/google/authorize")
      .set("Origin", "http://localhost:5173").type("form").send({ launchToken }).expect(303);
    expect(launch.headers.location).toBe(authorizationUrl);
    expect(responseCookie(launch)).toMatchObject({ value: state, httpOnly: true, sameSite: "lax", path: callbackPath });
    await browser.get(callbackPath).query({ state, code: "valid-code" }).expect(303);
    expect(completeCalendarOAuth).toHaveBeenCalledOnce();
  });

  it.each([undefined, "null", "https://attacker.example"])("rejects untrusted launch origin %s", async (origin) => {
    const call = request(app).post("/api/calendar/oauth/google/authorize");
    if (origin) call.set("Origin", origin);
    const response = await call.type("form").send({ launchToken: "invalid" }).expect(403);
    expect(response.headers["set-cookie"]).toBeUndefined();
  });

  it.each([
    { expiresAt: 0, authorizationUrl },
    { expiresAt: Date.now() + 600_000, authorizationUrl: "https://attacker.example/?state=" + state },
    { expiresAt: Date.now() + 600_000, authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth?state=short" }
  ])("rejects expired or unsafe signed launch %#", async (payload) => {
    const launchToken = encryptCalendarSecret(JSON.stringify(payload), "calendar-oauth-launch", process.env);
    const response = await request(app).post("/api/calendar/oauth/google/authorize")
      .set("Origin", "http://localhost:5173").type("form").send({ launchToken }).expect(400);
    expect(response.headers["set-cookie"]).toBeUndefined();
  });

  it("rejects tampered launch tokens", async () => {
    const response = await request(app).post("/api/calendar/oauth/google/authorize")
      .set("Origin", "http://localhost:5173").type("form").send({ launchToken: "tampered" }).expect(400);
    expect(response.headers["set-cookie"]).toBeUndefined();
  });

  it.each([
    { redirect: `https://api.example.test${callbackPath}`, forwarded: "http", secure: true },
    { redirect: `http://localhost:4000${callbackPath}`, forwarded: "https", secure: undefined }
  ])("uses the trusted redirect for cookie security: $redirect", async ({ redirect, forwarded, secure }) => {
    vi.stubEnv("GOOGLE_CALENDAR_REDIRECT_URI", redirect);
    const response = await request(app).post(startPath).set("Authorization", "Bearer manager")
      .set("X-Forwarded-Proto", forwarded).set("Host", "untrusted.example.test").send({}).expect(200);
    expect(responseCookie(response).secure).toBe(secure);
    const callback = await request(app).get(callbackPath).query({ state, code: "code" })
      .set("X-Forwarded-Proto", forwarded).expect(303);
    expect(responseCookie(callback).secure).toBe(secure);
    expect(completeCalendarOAuth).not.toHaveBeenCalled();
  });

  it.each([undefined, `calendar_oauth_state=${"b".repeat(43)}`, "calendar_oauth_state=%E0%A4%A", "unrelated=value"])(
    "rejects a missing or wrong browser cookie before exchange: %s", async (cookie) => {
      const call = request(app).get(callbackPath).query({ state, code: "victim-code" });
      if (cookie !== undefined) call.set("Cookie", cookie);
      const response = await call.expect(303);
      expect(response.headers.location).toContain("calendarOAuth=failed");
      expect(completeCalendarOAuth).not.toHaveBeenCalled();
      expect(responseCookie(response)).toMatchObject({ name: "calendar_oauth_state", value: "", httpOnly: true, sameSite: "lax", path: callbackPath });
      expect(responseCookie(response).expires?.getTime()).toBeLessThan(Date.now());
    }
  );

  it.each([{}, { state: "short" }, { state: [state, state] }])("rejects absent or malformed callback state %#", async (query) => {
    await request(app).get(callbackPath).query({ ...query, code: "code" })
      .set("Cookie", `calendar_oauth_state=${state}`).expect(303);
    expect(completeCalendarOAuth).not.toHaveBeenCalled();
  });

  it("allows the browser that started OAuth and clears its cookie", async () => {
    const browser = request.agent(app);
    await browser.post(startPath).set("Authorization", "Bearer manager").send({}).expect(200);
    const response = await browser.get(callbackPath).query({ state, code: "valid-code" }).expect(303);
    expect(completeCalendarOAuth).toHaveBeenCalledExactlyOnceWith({ state, code: "valid-code", error: undefined });
    expect(response.headers.location).toContain("calendarOAuth=connected");
    expect(responseCookie(response).value).toBe("");
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["referrer-policy"]).toBe("no-referrer");
    await browser.get(callbackPath).query({ state, code: "valid-code" }).expect(303);
    expect(completeCalendarOAuth).toHaveBeenCalledOnce();
  });

  it("rejects a copied authorization URL in a different browser", async () => {
    await request.agent(app).post(startPath).set("Authorization", "Bearer manager").send({}).expect(200);
    await request.agent(app).get(callbackPath).query({ state, code: "victim-code" }).expect(303);
    expect(completeCalendarOAuth).not.toHaveBeenCalled();
  });

  it.each(["cancelled", "exchange-failure"])("clears the cookie on %s", async (outcome) => {
    if (outcome === "cancelled") vi.mocked(completeCalendarOAuth).mockResolvedValue("cancelled");
    else vi.mocked(completeCalendarOAuth).mockRejectedValue(new Error("Exchange failed"));
    const response = await request(app).get(callbackPath).query({ state, error: "access_denied" })
      .set("Cookie", `calendar_oauth_state=${state}`).expect(303);
    expect(completeCalendarOAuth).toHaveBeenCalledExactlyOnceWith({ state, code: undefined, error: "access_denied" });
    expect(responseCookie(response).value).toBe("");
    expect(response.headers.location).toContain(`calendarOAuth=${outcome === "cancelled" ? "cancelled" : "failed"}`);
  });

  it("includes browser credentials only for the frontend OAuth start request", async () => {
    const { getCalendarOAuthStatus, startCalendarOAuth: startCalendarOAuthRequest } = await vi.importActual<{
      getCalendarOAuthStatus: (token: string) => Promise<unknown>;
      startCalendarOAuth: (token: string) => Promise<unknown>;
    }>("../../../../web/src/services/api/integrations.js");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(() => Promise.resolve(
      new Response(JSON.stringify({ authorizationUrl }), { status: 200 })
    ));
    await startCalendarOAuthRequest("token");
    expect(fetchMock).toHaveBeenLastCalledWith(expect.stringContaining(startPath), expect.objectContaining({ credentials: "include", method: "POST" }));
    await getCalendarOAuthStatus("token");
    expect(fetchMock.mock.calls[1]?.[1]?.credentials).toBeUndefined();
  });
});
