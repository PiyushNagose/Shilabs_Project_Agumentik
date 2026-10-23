import { timingSafeEqual } from "node:crypto";
import { parseCookie } from "cookie";
import { Router, urlencoded, type CookieOptions } from "express";
import { UserRole } from "@prisma/client";
import { asyncHandler } from "../../middleware/async-handler.js";
import { getRequiredUser, requireAuth, requireRole } from "../../middleware/auth.middleware.js";
import { calendarOAuthRedirect, completeCalendarOAuth, isCalendarOAuthEnabled, startCalendarOAuth } from "./calendar-oauth.service.js";
import { AppError } from "../../shared/errors.js";
import { decryptCalendarSecret, encryptCalendarSecret } from "./calendar-oauth.crypto.js";
import { validateBody } from "../../middleware/validate.middleware.js";
import {
  getCalendarAvailabilityController,
  getCalendarHealthController
} from "./calendar.controller.js";
import { calendarAvailabilitySchema } from "./calendar.schemas.js";

export const calendarRoutes = Router();

const oauthStateCookie = "calendar_oauth_state";
const oauthStatePattern = /^[\w-]{43}$/;

function oauthCookieOptions(): CookieOptions {
  const redirect = new URL(process.env.GOOGLE_CALENDAR_REDIRECT_URI ?? "");
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: redirect.protocol === "https:",
    path: redirect.pathname
  };
}

// Set the callback cookie during top-level navigation, not a cross-site fetch.
calendarRoutes.post("/oauth/google/authorize", urlencoded({ extended: false, limit: "8kb" }), (request, response) => {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Referrer-Policy", "no-referrer");
  if (!process.env.WEB_ORIGIN || request.headers.origin !== new URL(process.env.WEB_ORIGIN).origin) {
    throw new AppError(403, "AUTHORIZATION_ERROR", "Start calendar authorization from this workspace");
  }
  const body: unknown = request.body;
  if (!body || typeof body !== "object" || !("launchToken" in body) || typeof body.launchToken !== "string" || body.launchToken.length > 6000) {
    throw new AppError(400, "VALIDATION_ERROR", "Invalid calendar authorization request");
  }
  let launch: unknown;
  try {
    launch = JSON.parse(decryptCalendarSecret(body.launchToken, "calendar-oauth-launch", process.env));
  } catch {
    throw new AppError(400, "VALIDATION_ERROR", "Calendar authorization expired; reconnect again");
  }
  if (!launch || typeof launch !== "object" || !("expiresAt" in launch) ||
      typeof launch.expiresAt !== "number" || launch.expiresAt <= Date.now() ||
      !("authorizationUrl" in launch) || typeof launch.authorizationUrl !== "string") {
    throw new AppError(400, "VALIDATION_ERROR", "Calendar authorization expired; reconnect again");
  }
  const target = new URL(launch.authorizationUrl);
  const state = target.searchParams.get("state");
  if (target.origin !== "https://accounts.google.com" || target.pathname !== "/o/oauth2/v2/auth" || !state || !oauthStatePattern.test(state)) {
    throw new AppError(400, "VALIDATION_ERROR", "Invalid calendar authorization destination");
  }
  response.cookie(oauthStateCookie, state, { ...oauthCookieOptions(), maxAge: 10 * 60 * 1000 });
  response.redirect(303, target.href);
});

calendarRoutes.get("/oauth/google/callback", asyncHandler(async (request, response) => {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Referrer-Policy", "no-referrer");
  const redirect = calendarOAuthRedirect("failed");
  try {
    response.clearCookie(oauthStateCookie, oauthCookieOptions());
    const query = request.query;
    const state = typeof query.state === "string" ? query.state : undefined;
    const browserState = parseCookie(request.headers.cookie ?? "")[oauthStateCookie];
    if (!state || !browserState || !oauthStatePattern.test(state) || !oauthStatePattern.test(browserState) ||
        !timingSafeEqual(Buffer.from(state), Buffer.from(browserState))) {
      throw new AppError(400, "VALIDATION_ERROR", "Calendar authorization browser state is invalid");
    }
    const status = await completeCalendarOAuth({
      state,
      code: typeof query.code === "string" ? query.code : undefined,
      error: typeof query.error === "string" ? query.error : undefined
    });
    response.redirect(303, calendarOAuthRedirect(status));
  } catch {
    response.redirect(303, redirect);
  }
}));

calendarRoutes.use(requireAuth);

calendarRoutes.get("/oauth/google/status", requireRole([UserRole.ADMIN, UserRole.SALES_MANAGER]), (_request, response) => {
  response.setHeader("Cache-Control", "no-store");
  response.json({ enabled: isCalendarOAuthEnabled() });
});

calendarRoutes.post("/oauth/google/start", requireRole([UserRole.ADMIN, UserRole.SALES_MANAGER]), asyncHandler(async (request, response) => {
  const body: unknown = request.body;
  let calendarId = "primary";
  if (body !== undefined) {
    if (body === null || typeof body !== "object" || Array.isArray(body)) throw new AppError(400, "VALIDATION_ERROR", "Invalid calendar reconnect request");
    if ("calendarId" in body) {
      if (typeof body.calendarId !== "string") throw new AppError(400, "VALIDATION_ERROR", "Invalid calendar ID");
      calendarId = body.calendarId;
    }
  }
  response.setHeader("Cache-Control", "no-store");
  const options = oauthCookieOptions();
  const result = await startCalendarOAuth(getRequiredUser(request), calendarId);
  const state = new URL(result.authorizationUrl).searchParams.get("state");
  if (!state || !oauthStatePattern.test(state)) {
    throw new AppError(503, "PROVIDER_ERROR", "Invalid calendar authorization state");
  }
  response.cookie(oauthStateCookie, state, { ...options, maxAge: 10 * 60 * 1000 });
  response.json({ ...result, launchToken: encryptCalendarSecret(JSON.stringify({
    authorizationUrl: result.authorizationUrl, expiresAt: Date.now() + 60_000
  }), "calendar-oauth-launch", process.env) });
}));

calendarRoutes.get(
  "/health",
  requireRole([UserRole.ADMIN, UserRole.SALES_MANAGER]),
  asyncHandler(getCalendarHealthController)
);

calendarRoutes.post(
  "/availability",
  requireRole([UserRole.ADMIN, UserRole.SALES_MANAGER, UserRole.SALES_REP]),
  validateBody(calendarAvailabilitySchema),
  asyncHandler(getCalendarAvailabilityController)
);
