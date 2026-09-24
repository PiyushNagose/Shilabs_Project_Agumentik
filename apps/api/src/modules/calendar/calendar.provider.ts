import { createHash } from "node:crypto";
import type { CalendarConfig } from "@shilabs/shared-config";
import type {
  CalendarAvailabilityResultDto,
  CalendarHealthDto,
  CalendarProviderName
} from "@shilabs/shared-types";
import { z } from "zod";

export interface CalendarAvailabilityInput {
  ownerUserId: string;
  timeZone: string;
  windowStart: Date;
  windowEnd: Date;
  slotMinutes: number;
}

export interface CalendarProvider {
  getHealth(): Promise<CalendarHealthDto>;
  getAvailability(input: CalendarAvailabilityInput): Promise<CalendarAvailabilityResultDto>;
  createMeeting(input: CalendarMeetingCreateInput): Promise<CalendarMeetingCreateResult>;
}

export type CalendarTransport = typeof fetch;

const googleTokenResponseSchema = z.object({
  access_token: z.string().optional(),
  expires_in: z.number().optional(),
  scope: z.string().optional(),
  token_type: z.string().optional(),
  error: z.string().optional(),
  error_description: z.string().optional()
});

const googleFreeBusyResponseSchema = z.object({
  calendars: z.record(
    z.string(),
    z.object({
      busy: z
        .array(
          z.object({
            start: z.string(),
            end: z.string()
          })
        )
        .optional(),
      errors: z
        .array(
          z.object({
            domain: z.string().optional(),
            reason: z.string().optional()
          })
        )
        .optional()
    })
  )
});

const googleApiErrorResponseSchema = z.object({
  error: z
    .object({
      code: z.number().optional(),
      message: z.string().optional(),
      status: z.string().optional(),
      errors: z
        .array(
          z.object({
            domain: z.string().optional(),
            reason: z.string().optional(),
            message: z.string().optional()
          })
        )
        .optional()
    })
    .optional()
});

const GOOGLE_FREEBUSY_SCOPE = "https://www.googleapis.com/auth/calendar.freebusy";
const GOOGLE_EVENT_WRITE_SCOPE = "https://www.googleapis.com/auth/calendar.events";

export interface CalendarMeetingCreateInput {
  idempotencyKey: string;
  title: string;
  description?: string | null;
  startsAt: Date;
  endsAt: Date;
  timeZone: string;
  attendees: string[];
}

export interface CalendarMeetingCreateResult {
  provider: CalendarProviderName;
  status: "SYNCED" | "FAILED" | "NOT_CONFIGURED";
  externalMeetingId: string | null;
  externalMeetingUrl: string | null;
  lastError: string | null;
}

interface GoogleAccessToken {
  accessToken: string;
  scopes: string[];
  expiresAt: Date;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

function sanitizeError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return "Google Calendar request failed";
}

function formatGoogleApiError(rawBody: unknown): string | null {
  const parsed = googleApiErrorResponseSchema.safeParse(rawBody);
  if (!parsed.success || !parsed.data.error) {
    return null;
  }

  const providerError = parsed.data.error;
  const firstDetail = providerError.errors?.[0];
  const parts = [
    providerError.code ? `code ${String(providerError.code)}` : null,
    providerError.status ? `status ${providerError.status}` : null,
    firstDetail?.reason ? `reason ${firstDetail.reason}` : null,
    providerError.message ?? firstDetail?.message ?? null
  ].filter(Boolean);

  if (parts.length === 0) {
    return null;
  }

  return parts.join("; ").slice(0, 500);
}

function googleApiFailureMessage(action: string, status: number, rawBody: unknown): string {
  const details = formatGoogleApiError(rawBody);
  return `${action} failed with status ${String(status)}${details ? `: ${details}` : ""}`;
}

function buildGoogleEventId(idempotencyKey: string): string {
  return `meeting${createHash("sha256").update(idempotencyKey).digest("hex")}`;
}

function splitScopes(scope: string | undefined): string[] {
  return (scope ?? "")
    .split(/\s+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function requiredGoogleScopes(config: CalendarConfig): string[] {
  return config.google.scope
    .split(/\s+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function hasScope(scopes: string[], scope: string): boolean {
  return scopes.includes(scope);
}

function missingGoogleConfig(config: CalendarConfig): string[] {
  const missing: string[] = [];
  if (!config.google.clientId) missing.push("GOOGLE_CALENDAR_CLIENT_ID");
  if (!config.google.clientSecret) missing.push("GOOGLE_CALENDAR_CLIENT_SECRET");
  if (!config.google.refreshToken) missing.push("GOOGLE_CALENDAR_REFRESH_TOKEN");
  if (!config.google.calendarId) missing.push("GOOGLE_CALENDAR_ID");
  if (!requiredGoogleScopes(config).includes(GOOGLE_FREEBUSY_SCOPE)) {
    missing.push("GOOGLE_CALENDAR_SCOPE");
  }
  return missing;
}

function missingGoogleMeetingConfig(config: CalendarConfig): string[] {
  const missing = missingGoogleConfig(config);
  if (!requiredGoogleScopes(config).includes(GOOGLE_EVENT_WRITE_SCOPE)) {
    missing.push("GOOGLE_CALENDAR_SCOPE_EVENTS");
  }
  return missing;
}

function toProviderName(provider: CalendarConfig["provider"]): CalendarProviderName {
  if (provider === "google") {
    return "GOOGLE";
  }
  if (provider === "microsoft") {
    return "MICROSOFT";
  }
  return "NONE";
}

function baseAvailability(
  provider: CalendarProviderName,
  input: CalendarAvailabilityInput,
  unavailableReason: string
): CalendarAvailabilityResultDto {
  return {
    provider,
    status: provider === "NONE" ? "NOT_CONFIGURED" : "ERROR",
    checkedAt: new Date().toISOString(),
    timeZone: input.timeZone,
    windowStart: input.windowStart.toISOString(),
    windowEnd: input.windowEnd.toISOString(),
    slotMinutes: input.slotMinutes,
    slots: [],
    unavailableReason
  };
}

function toErrorAvailability(
  provider: CalendarProviderName,
  input: CalendarAvailabilityInput,
  unavailableReason: string
): CalendarAvailabilityResultDto {
  return {
    ...baseAvailability(provider, input, unavailableReason),
    status: "ERROR"
  };
}

function overlapsBusy(
  input: { start: Date; end: Date },
  busy: { start: Date; end: Date }
): boolean {
  return input.start < busy.end && input.end > busy.start;
}

function buildFreeSlots(input: CalendarAvailabilityInput, busy: { start: Date; end: Date }[]) {
  const slots = [];
  const stepMs = input.slotMinutes * 60 * 1000;
  for (
    let startsAt = input.windowStart.getTime();
    startsAt + stepMs <= input.windowEnd.getTime();
    startsAt += stepMs
  ) {
    const candidate = {
      start: new Date(startsAt),
      end: new Date(startsAt + stepMs)
    };
    if (busy.some((item) => overlapsBusy(candidate, item))) {
      continue;
    }

    slots.push({
      startsAt: candidate.start.toISOString(),
      endsAt: candidate.end.toISOString(),
      timeZone: input.timeZone
    });
  }

  return slots;
}

export class NotConfiguredCalendarProvider implements CalendarProvider {
  public constructor(private readonly config: CalendarConfig) {}

  public getHealth(): Promise<CalendarHealthDto> {
    return Promise.resolve({
      provider: "NONE",
      status: "NOT_CONFIGURED",
      configured: false,
      checkedAt: new Date().toISOString(),
      defaultTimeZone: this.config.defaultTimeZone,
      missingConfig: ["CALENDAR_PROVIDER"],
      lastError: "Calendar provider is not configured"
    });
  }

  public getAvailability(input: CalendarAvailabilityInput): Promise<CalendarAvailabilityResultDto> {
    return Promise.resolve(baseAvailability("NONE", input, "Calendar provider is not configured"));
  }

  public createMeeting(): Promise<CalendarMeetingCreateResult> {
    return Promise.resolve({
      provider: "NONE",
      status: "NOT_CONFIGURED",
      externalMeetingId: null,
      externalMeetingUrl: null,
      lastError: "Calendar provider is not configured"
    });
  }
}

export class GoogleCalendarProvider implements CalendarProvider {
  private cachedToken: GoogleAccessToken | null = null;

  public constructor(
    private readonly config: CalendarConfig,
    private readonly transport: CalendarTransport = fetch
  ) {}

  public async getHealth(): Promise<CalendarHealthDto> {
    const missingConfig = missingGoogleConfig(this.config);
    if (missingConfig.length > 0) {
      return {
        provider: "GOOGLE",
        status: "NOT_CONFIGURED",
        configured: false,
        checkedAt: new Date().toISOString(),
        defaultTimeZone: this.config.defaultTimeZone,
        missingConfig,
        lastError: "Google Calendar is missing required configuration"
      };
    }

    try {
      await this.queryFreeBusy({
        ownerUserId: "health-check",
        timeZone: this.config.defaultTimeZone,
        windowStart: new Date(),
        windowEnd: new Date(Date.now() + 60_000),
        slotMinutes: this.config.slotMinutes
      });

      return {
        provider: "GOOGLE",
        status: "CONFIGURED",
        configured: true,
        checkedAt: new Date().toISOString(),
        defaultTimeZone: this.config.defaultTimeZone,
        missingConfig: [],
        lastError: null
      };
    } catch (error) {
      return {
        provider: "GOOGLE",
        status: "ERROR",
        configured: true,
        checkedAt: new Date().toISOString(),
        defaultTimeZone: this.config.defaultTimeZone,
        missingConfig: [],
        lastError: sanitizeError(error)
      };
    }
  }

  public async getAvailability(
    input: CalendarAvailabilityInput
  ): Promise<CalendarAvailabilityResultDto> {
    const missingConfig = missingGoogleConfig(this.config);
    if (missingConfig.length > 0) {
      return {
        ...baseAvailability("GOOGLE", input, "Google Calendar is missing required configuration"),
        status: "NOT_CONFIGURED"
      };
    }

    try {
      const busy = await this.queryFreeBusy(input);
      return {
        provider: "GOOGLE",
        status: "AVAILABLE",
        checkedAt: new Date().toISOString(),
        timeZone: input.timeZone,
        windowStart: input.windowStart.toISOString(),
        windowEnd: input.windowEnd.toISOString(),
        slotMinutes: input.slotMinutes,
        slots: buildFreeSlots(input, busy),
        unavailableReason: null
      };
    } catch (error) {
      return toErrorAvailability("GOOGLE", input, sanitizeError(error));
    }
  }

  public async createMeeting(
    input: CalendarMeetingCreateInput
  ): Promise<CalendarMeetingCreateResult> {
    const missingConfig = missingGoogleMeetingConfig(this.config);
    if (missingConfig.length > 0) {
      return {
        provider: "GOOGLE",
        status: "NOT_CONFIGURED",
        externalMeetingId: null,
        externalMeetingUrl: null,
        lastError: `Google Calendar meeting creation is missing required configuration: ${missingConfig.join(
          ", "
        )}`
      };
    }

    try {
      const token = await this.getAccessToken();
      if (!hasScope(token.scopes, GOOGLE_EVENT_WRITE_SCOPE)) {
        throw new Error("Google OAuth token is missing calendar.events scope");
      }

      const eventId = buildGoogleEventId(input.idempotencyKey);
      const response = await this.requestWithRetry(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(
          this.config.google.calendarId
        )}/events?sendUpdates=none`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token.accessToken}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            id: eventId,
            summary: input.title,
            description: input.description ?? undefined,
            start: {
              dateTime: input.startsAt.toISOString(),
              timeZone: input.timeZone
            },
            end: {
              dateTime: input.endsAt.toISOString(),
              timeZone: input.timeZone
            },
            attendees: input.attendees.map((email) => ({ email })),
            extendedProperties: {
              private: {
                shilabsIdempotencyKey: input.idempotencyKey
              }
            }
          })
        }
      );

      const rawBody = (await response.json().catch(() => null)) as {
        id?: unknown;
        htmlLink?: unknown;
        error?: unknown;
      } | null;
      if (!response.ok) {
        throw new Error(
          googleApiFailureMessage("Google Calendar event insert", response.status, rawBody)
        );
      }

      if (!rawBody || typeof rawBody.id !== "string") {
        throw new Error("Google Calendar event insert response was malformed");
      }

      return {
        provider: "GOOGLE",
        status: "SYNCED",
        externalMeetingId: rawBody.id,
        externalMeetingUrl: typeof rawBody.htmlLink === "string" ? rawBody.htmlLink : null,
        lastError: null
      };
    } catch (error) {
      return {
        provider: "GOOGLE",
        status: "FAILED",
        externalMeetingId: null,
        externalMeetingUrl: null,
        lastError: sanitizeError(error)
      };
    }
  }

  private async queryFreeBusy(
    input: CalendarAvailabilityInput
  ): Promise<{ start: Date; end: Date }[]> {
    const token = await this.getAccessToken();
    const response = await this.requestWithRetry(
      "https://www.googleapis.com/calendar/v3/freeBusy",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token.accessToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          timeMin: input.windowStart.toISOString(),
          timeMax: input.windowEnd.toISOString(),
          timeZone: input.timeZone,
          items: [{ id: this.config.google.calendarId }]
        })
      }
    );

    const rawBody: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(
        googleApiFailureMessage("Google Calendar FreeBusy", response.status, rawBody)
      );
    }

    const parsed = googleFreeBusyResponseSchema.safeParse(rawBody);
    if (!parsed.success) {
      throw new Error("Google Calendar FreeBusy response was malformed");
    }

    const calendar = parsed.data.calendars[this.config.google.calendarId];
    if (!calendar) {
      throw new Error("Google Calendar FreeBusy response did not include configured calendar");
    }

    if (calendar.errors?.length) {
      const reasons = calendar.errors
        .map((item) => item.reason ?? item.domain ?? "unknown")
        .join(", ");
      throw new Error(`Google Calendar FreeBusy calendar error: ${reasons}`);
    }

    return (calendar.busy ?? []).map((item) => ({
      start: new Date(item.start),
      end: new Date(item.end)
    }));
  }

  private async getAccessToken(): Promise<GoogleAccessToken> {
    if (this.cachedToken && this.cachedToken.expiresAt > new Date(Date.now() + 120_000)) {
      return this.cachedToken;
    }

    const body = new URLSearchParams({
      client_id: this.config.google.clientId,
      client_secret: this.config.google.clientSecret,
      refresh_token: this.config.google.refreshToken,
      grant_type: "refresh_token",
      scope: this.config.google.scope
    });

    const response = await this.requestWithRetry("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body
    });
    const rawBody: unknown = await response.json().catch(() => null);
    const parsed = googleTokenResponseSchema.safeParse(rawBody);
    if (!parsed.success) {
      throw new Error("Google OAuth token response was malformed");
    }

    const tokenBody = parsed.data;
    if (tokenBody.error) {
      throw new Error(`Google OAuth error: ${tokenBody.error}`);
    }

    if (!response.ok || !tokenBody.access_token || !tokenBody.expires_in) {
      throw new Error(`Google OAuth token refresh failed with status ${String(response.status)}`);
    }

    const scopes = splitScopes(tokenBody.scope);
    if (!hasScope(scopes, GOOGLE_FREEBUSY_SCOPE)) {
      throw new Error("Google OAuth token is missing calendar.freebusy scope");
    }

    this.cachedToken = {
      accessToken: tokenBody.access_token,
      scopes,
      expiresAt: new Date(Date.now() + tokenBody.expires_in * 1000)
    };

    return this.cachedToken;
  }

  private async requestWithRetry(url: string, init: RequestInit): Promise<Response> {
    for (let attempt = 0; attempt <= this.config.maxRetries; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);
      try {
        const response = await this.transport(url, { ...init, signal: controller.signal });
        clearTimeout(timeout);

        if (!isRetryableStatus(response.status) || attempt === this.config.maxRetries) {
          return response;
        }
      } catch {
        clearTimeout(timeout);
        if (attempt === this.config.maxRetries) break;
      }

      await sleep(250 * (attempt + 1));
    }

    throw new Error("Google Calendar request failed after retries");
  }
}

export class UnsupportedCalendarProvider implements CalendarProvider {
  private readonly providerName: CalendarProviderName;

  public constructor(private readonly config: CalendarConfig) {
    this.providerName = toProviderName(config.provider);
  }

  public getHealth(): Promise<CalendarHealthDto> {
    return Promise.resolve({
      provider: this.providerName,
      status: "ERROR",
      configured: false,
      checkedAt: new Date().toISOString(),
      defaultTimeZone: this.config.defaultTimeZone,
      missingConfig: [],
      lastError: "Provider-specific calendar adapter is not implemented in R20"
    });
  }

  public getAvailability(input: CalendarAvailabilityInput): Promise<CalendarAvailabilityResultDto> {
    return Promise.resolve(
      baseAvailability(
        this.providerName,
        input,
        "Provider-specific calendar adapter is not implemented in R20"
      )
    );
  }

  public createMeeting(): Promise<CalendarMeetingCreateResult> {
    return Promise.resolve({
      provider: this.providerName,
      status: "FAILED",
      externalMeetingId: null,
      externalMeetingUrl: null,
      lastError: "Provider-specific calendar adapter is not implemented in R21"
    });
  }
}

export function createCalendarProvider(config: CalendarConfig): CalendarProvider {
  if (config.provider === "none") {
    return new NotConfiguredCalendarProvider(config);
  }

  if (config.provider === "google") {
    return new GoogleCalendarProvider(config);
  }

  return new UnsupportedCalendarProvider(config);
}
