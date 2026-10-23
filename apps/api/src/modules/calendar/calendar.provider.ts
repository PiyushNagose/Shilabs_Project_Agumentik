import { createHash } from "node:crypto";
import type { CalendarConfig } from "@shilabs/shared-config";
import type {
  CalendarAvailabilityResultDto,
  CalendarHealthDto,
  CalendarProviderName
} from "@shilabs/shared-types";
import { z } from "zod";
import { redactSecrets } from "../../shared/redaction.js";

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
  cancelMeeting(input: { externalMeetingId: string }): Promise<{ status: "SYNCED" | "FAILED" | "NOT_CONFIGURED"; lastError: string | null }>;
  rescheduleMeeting(input: CalendarMeetingRescheduleInput): Promise<{ status: "SYNCED" | "FAILED" | "NOT_CONFIGURED"; lastError: string | null }>;
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

const googleEventResponseSchema = z.object({
  id: z.string(),
  status: z.string().optional(),
  htmlLink: z.string(),
  hangoutLink: z.string().optional(),
  organizer: z
    .object({
      email: z.string().optional()
    })
    .optional()
});

const GOOGLE_FREEBUSY_SCOPE = "https://www.googleapis.com/auth/calendar.freebusy";
const GOOGLE_EVENT_WRITE_SCOPE = "https://www.googleapis.com/auth/calendar.events";

const microsoftTokenResponseSchema = z.object({
  access_token: z.string().optional(),
  expires_in: z.number().optional(),
  error: z.string().optional(),
  error_description: z.string().optional()
});

const microsoftScheduleResponseSchema = z.object({
  value: z.array(
    z.object({
      scheduleItems: z.array(
        z.object({
          start: z.object({ dateTime: z.string() }),
          end: z.object({ dateTime: z.string() })
        })
      )
    })
  )
});

const microsoftEventResponseSchema = z.object({
  id: z.string(),
  webLink: z.string(),
  isCancelled: z.boolean().optional(),
  onlineMeeting: z.object({ joinUrl: z.string().optional() }).nullable().optional(),
  organizer: z.object({ emailAddress: z.object({ address: z.string().optional() }) }).optional()
});

const zoomTokenResponseSchema = z.object({
  access_token: z.string().optional(),
  expires_in: z.number().optional(),
  error: z.string().optional(),
  reason: z.string().optional()
});

const zoomMeetingResponseSchema = z.object({
  id: z.union([z.string(), z.number()]),
  join_url: z.url(),
  host_email: z.string().optional()
});

export interface CalendarMeetingCreateInput {
  idempotencyKey: string;
  title: string;
  description?: string | null;
  startsAt: Date;
  endsAt: Date;
  timeZone: string;
  attendees: string[];
  meetingMode?: "VIDEO" | "PHONE" | "IN_PERSON";
  location?: string | null;
}

export interface CalendarMeetingRescheduleInput {
  externalMeetingId: string;
  startsAt: Date;
  endsAt: Date;
  timeZone: string;
}

export interface CalendarMeetingCreateResult {
  provider: CalendarProviderName;
  status: "SYNCED" | "FAILED" | "NOT_CONFIGURED";
  externalMeetingId: string | null;
  externalMeetingUrl: string | null;
  externalCalendarId: string | null;
  organizerEmail: string | null;
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
    return redactSecrets(error.message).slice(0, 500);
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

function missingMicrosoftConfig(config: CalendarConfig): string[] {
  const missing: string[] = [];
  if (!config.microsoft.tenantId) missing.push("MICROSOFT_CALENDAR_TENANT_ID");
  if (!config.microsoft.clientId) missing.push("MICROSOFT_CALENDAR_CLIENT_ID");
  if (!config.microsoft.clientSecret) missing.push("MICROSOFT_CALENDAR_CLIENT_SECRET");
  if (!config.microsoft.userId) missing.push("MICROSOFT_CALENDAR_USER_ID");
  return missing;
}

function missingZoomConfig(config: CalendarConfig): string[] {
  if (config.conferenceProvider !== "zoom") return [];
  const missing: string[] = [];
  if (!config.zoom.accountId) missing.push("ZOOM_ACCOUNT_ID");
  if (!config.zoom.clientId) missing.push("ZOOM_CLIENT_ID");
  if (!config.zoom.clientSecret) missing.push("ZOOM_CLIENT_SECRET");
  if (!config.zoom.hostUserId) missing.push("ZOOM_HOST_USER_ID");
  return missing;
}

function appendConferenceLink(description: string | null | undefined, label: string, url: string) {
  return [description?.trim(), `${label}: ${url}`].filter(Boolean).join("\n\n");
}

function parseMicrosoftDateTime(value: string): Date {
  return new Date(/[zZ]|[+-]\d{2}:\d{2}$/.test(value) ? value : `${value}Z`);
}

export interface ZoomMeetingResult {
  id: string;
  joinUrl: string;
  hostEmail: string | null;
}

export class ZoomConferenceProvider {
  public constructor(
    private readonly config: CalendarConfig,
    private readonly transport: CalendarTransport = fetch
  ) {}

  public missingConfig(): string[] {
    return missingZoomConfig(this.config);
  }

  public async getHealth(): Promise<{ configured: boolean; error: string | null }> {
    const missing = this.missingConfig();
    if (missing.length > 0) {
      return {
        configured: false,
        error: `Zoom is missing required configuration: ${missing.join(", ")}`
      };
    }
    try {
      await this.getAccessToken();
      return { configured: true, error: null };
    } catch (error) {
      return { configured: false, error: sanitizeError(error) };
    }
  }

  public async createMeeting(input: CalendarMeetingCreateInput): Promise<ZoomMeetingResult> {
    const missing = this.missingConfig();
    if (missing.length > 0) {
      throw new Error(`Zoom is missing required configuration: ${missing.join(", ")}`);
    }

    const accessToken = await this.getAccessToken();
    const response = await this.transport(
      `https://api.zoom.us/v2/users/${encodeURIComponent(this.config.zoom.hostUserId)}/meetings`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          topic: input.title,
          type: 2,
          start_time: input.startsAt.toISOString(),
          duration: Math.max(
            1,
            Math.ceil((input.endsAt.getTime() - input.startsAt.getTime()) / 60000)
          ),
          timezone: input.timeZone,
          agenda: input.description ?? undefined,
          settings: {
            join_before_host: false,
            waiting_room: true
          }
        })
      }
    );
    const rawMeeting: unknown = await response.json().catch(() => null);
    const meeting = zoomMeetingResponseSchema.safeParse(rawMeeting);
    if (!response.ok || !meeting.success) {
      throw new Error(`Zoom meeting creation failed with status ${String(response.status)}`);
    }
    return {
      id: String(meeting.data.id),
      joinUrl: meeting.data.join_url,
      hostEmail: meeting.data.host_email ?? null
    };
  }

  private async getAccessToken(): Promise<string> {
    const credentials = Buffer.from(
      `${this.config.zoom.clientId}:${this.config.zoom.clientSecret}`
    ).toString("base64");
    const tokenUrl = new URL("https://zoom.us/oauth/token");
    tokenUrl.searchParams.set("grant_type", "account_credentials");
    tokenUrl.searchParams.set("account_id", this.config.zoom.accountId);
    const tokenResponse = await this.transport(tokenUrl, {
      method: "POST",
      headers: { Authorization: `Basic ${credentials}` }
    });
    const rawToken: unknown = await tokenResponse.json().catch(() => null);
    const token = zoomTokenResponseSchema.safeParse(rawToken);
    if (!token.success || !tokenResponse.ok || !token.data.access_token) {
      const detail = token.success ? (token.data.reason ?? token.data.error ?? null) : null;
      throw new Error(
        `Zoom OAuth failed with status ${String(tokenResponse.status)}${detail ? `: ${detail}` : ""}`
      );
    }
    return token.data.access_token;
  }
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
      externalCalendarId: null,
      organizerEmail: null,
      lastError: "Calendar provider is not configured"
    });
  }

  public cancelMeeting(): Promise<{ status: "NOT_CONFIGURED"; lastError: string }> {
    return Promise.resolve({ status: "NOT_CONFIGURED", lastError: "Calendar provider is not configured" });
  }

  public rescheduleMeeting(): Promise<{ status: "NOT_CONFIGURED"; lastError: string }> {
    return Promise.resolve({ status: "NOT_CONFIGURED", lastError: "Calendar provider is not configured" });
  }
}

export class GoogleCalendarProvider implements CalendarProvider {
  private cachedToken: GoogleAccessToken | null = null;

  public constructor(
    private readonly config: CalendarConfig,
    private readonly transport: CalendarTransport = fetch
  ) {}

  public async rescheduleMeeting(input: CalendarMeetingRescheduleInput): Promise<{ status: "SYNCED" | "FAILED" | "NOT_CONFIGURED"; lastError: string | null }> {
    if (missingGoogleMeetingConfig(this.config).length) return { status: "NOT_CONFIGURED", lastError: "Google Calendar is not configured for meeting changes" };
    try {
      const token = await this.getAccessToken();
      if (!hasScope(token.scopes, GOOGLE_EVENT_WRITE_SCOPE)) throw new Error("Google OAuth token is missing calendar.events scope");
      const response = await this.requestWithRetry(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(this.config.google.calendarId)}/events/${encodeURIComponent(input.externalMeetingId)}?sendUpdates=all`,
        {
          method: "PATCH",
          headers: { Authorization: `Bearer ${token.accessToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            start: { dateTime: input.startsAt.toISOString(), timeZone: input.timeZone },
            end: { dateTime: input.endsAt.toISOString(), timeZone: input.timeZone }
          })
        }
      );
      if (!response.ok) throw new Error(`Google Calendar reschedule returned ${String(response.status)}`);
      return { status: "SYNCED", lastError: null };
    } catch (error) { return { status: "FAILED", lastError: sanitizeError(error) }; }
  }

  public async cancelMeeting(input: { externalMeetingId: string }): Promise<{ status: "SYNCED" | "FAILED" | "NOT_CONFIGURED"; lastError: string | null }> {
    const missing = missingGoogleMeetingConfig(this.config);
    if (missing.length > 0) return { status: "NOT_CONFIGURED", lastError: `Google Calendar is missing: ${missing.join(", ")}` };
    try {
      const token = await this.getAccessToken();
      if (!hasScope(token.scopes, GOOGLE_EVENT_WRITE_SCOPE)) throw new Error("Google OAuth token is missing calendar.events scope");
      const response = await this.requestWithRetry(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(this.config.google.calendarId)}/events/${encodeURIComponent(input.externalMeetingId)}?sendUpdates=all`,
        { method: "DELETE", headers: { Authorization: `Bearer ${token.accessToken}` } }
      );
      if (response.ok || response.status === 404) return { status: "SYNCED", lastError: null };
      return { status: "FAILED", lastError: `Google Calendar cancellation returned ${String(response.status)}` };
    } catch (error) {
      return { status: "FAILED", lastError: sanitizeError(error) };
    }
  }

  public async getHealth(): Promise<CalendarHealthDto> {
    const missingConfig = missingGoogleMeetingConfig(this.config);
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
      const token = await this.getAccessToken();
      if (!hasScope(token.scopes, GOOGLE_EVENT_WRITE_SCOPE)) {
        throw new Error("Google OAuth token is missing calendar.events scope; reconnect Google Calendar");
      }
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
    const missingConfig = [
      ...missingGoogleMeetingConfig(this.config),
      ...(input.meetingMode === undefined || input.meetingMode === "VIDEO" ? missingZoomConfig(this.config) : [])
    ];
    if (missingConfig.length > 0) {
      return {
        provider: "GOOGLE",
        status: "NOT_CONFIGURED",
        externalMeetingId: null,
        externalMeetingUrl: null,
        externalCalendarId: null,
        organizerEmail: null,
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
      const zoom =
        this.config.conferenceProvider === "zoom" && (input.meetingMode === undefined || input.meetingMode === "VIDEO")
          ? await new ZoomConferenceProvider(this.config, this.transport).createMeeting(input)
          : null;
      const response = await this.requestWithRetry(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(
          this.config.google.calendarId
        )}/events?sendUpdates=all&conferenceDataVersion=1`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token.accessToken}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            id: eventId,
            summary: input.title,
            description: zoom
              ? appendConferenceLink(input.description, "Join Zoom meeting", zoom.joinUrl)
              : (input.description ?? undefined),
            start: {
              dateTime: input.startsAt.toISOString(),
              timeZone: input.timeZone
            },
            end: {
              dateTime: input.endsAt.toISOString(),
              timeZone: input.timeZone
            },
            attendees: input.attendees.map((email) => ({ email })),
            location: input.location ?? undefined,
            conferenceData:
              this.config.conferenceProvider === "native" && (input.meetingMode === undefined || input.meetingMode === "VIDEO")
                ? {
                    createRequest: {
                      requestId: buildGoogleEventId(input.idempotencyKey),
                      conferenceSolutionKey: { type: "hangoutsMeet" }
                    }
                  }
                : undefined,
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
        if (response.status !== 409) {
          throw new Error(
            googleApiFailureMessage("Google Calendar event insert", response.status, rawBody)
          );
        }
      } else if (!rawBody || typeof rawBody.id !== "string") {
        throw new Error("Google Calendar event insert response was malformed");
      }

      const verified = await this.getEventById(token.accessToken, eventId);
      if (verified.id !== eventId) {
        throw new Error(
          "Google Calendar event read-after-write verification returned a different event"
        );
      }

      return {
        provider: "GOOGLE",
        status: "SYNCED",
        externalMeetingId: verified.id,
        externalMeetingUrl: zoom?.joinUrl ?? verified.hangoutLink ?? verified.htmlLink,
        externalCalendarId: this.config.google.calendarId,
        organizerEmail: verified.organizer?.email ?? null,
        lastError: null
      };
    } catch (error) {
      return {
        provider: "GOOGLE",
        status: "FAILED",
        externalMeetingId: null,
        externalMeetingUrl: null,
        externalCalendarId: null,
        organizerEmail: null,
        lastError: sanitizeError(error)
      };
    }
  }

  private async getEventById(
    accessToken: string,
    eventId: string
  ): Promise<z.infer<typeof googleEventResponseSchema>> {
    const response = await this.requestWithRetry(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(
        this.config.google.calendarId
      )}/events/${encodeURIComponent(eventId)}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`
        }
      }
    );
    const rawBody: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(
        googleApiFailureMessage("Google Calendar event get", response.status, rawBody)
      );
    }
    const parsed = googleEventResponseSchema.safeParse(rawBody);
    if (!parsed.success) {
      throw new Error("Google Calendar event get response was malformed");
    }
    if (parsed.data.status === "cancelled") {
      throw new Error(
        "Google Calendar event read-after-write verification returned a cancelled event"
      );
    }
    return parsed.data;
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

interface MicrosoftAccessToken {
  accessToken: string;
  expiresAt: Date;
}

export class MicrosoftCalendarProvider implements CalendarProvider {
  private cachedToken: MicrosoftAccessToken | null = null;

  public constructor(
    private readonly config: CalendarConfig,
    private readonly transport: CalendarTransport = fetch
  ) {}

  public async rescheduleMeeting(input: CalendarMeetingRescheduleInput): Promise<{ status: "SYNCED" | "FAILED" | "NOT_CONFIGURED"; lastError: string | null }> {
    if (missingMicrosoftConfig(this.config).length) return { status: "NOT_CONFIGURED", lastError: "Microsoft Calendar is not configured for meeting changes" };
    try {
      const token = await this.getAccessToken();
      const response = await this.requestWithRetry(
        `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(this.config.microsoft.userId)}/events/${encodeURIComponent(input.externalMeetingId)}`,
        {
          method: "PATCH",
          headers: { Authorization: `Bearer ${token.accessToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            start: { dateTime: input.startsAt.toISOString(), timeZone: "UTC" },
            end: { dateTime: input.endsAt.toISOString(), timeZone: "UTC" }
          })
        }
      );
      if (!response.ok) throw new Error(`Microsoft Calendar reschedule returned ${String(response.status)}`);
      return { status: "SYNCED", lastError: null };
    } catch (error) { return { status: "FAILED", lastError: sanitizeError(error) }; }
  }

  public async cancelMeeting(input: { externalMeetingId: string }): Promise<{ status: "SYNCED" | "FAILED" | "NOT_CONFIGURED"; lastError: string | null }> {
    const missing = missingMicrosoftConfig(this.config);
    if (missing.length > 0) return { status: "NOT_CONFIGURED", lastError: `Microsoft Calendar is missing: ${missing.join(", ")}` };
    try {
      const token = await this.getAccessToken();
      const response = await this.requestWithRetry(
        `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(this.config.microsoft.userId)}/events/${encodeURIComponent(input.externalMeetingId)}`,
        { method: "DELETE", headers: { Authorization: `Bearer ${token.accessToken}` } }
      );
      if (response.ok || response.status === 404) return { status: "SYNCED", lastError: null };
      return { status: "FAILED", lastError: `Microsoft Calendar cancellation returned ${String(response.status)}` };
    } catch (error) {
      return { status: "FAILED", lastError: sanitizeError(error) };
    }
  }

  public async getHealth(): Promise<CalendarHealthDto> {
    const missingConfig = missingMicrosoftConfig(this.config);
    if (missingConfig.length > 0) {
      return {
        provider: "MICROSOFT",
        status: "NOT_CONFIGURED",
        configured: false,
        checkedAt: new Date().toISOString(),
        defaultTimeZone: this.config.defaultTimeZone,
        missingConfig,
        lastError: "Microsoft Calendar is missing required configuration"
      };
    }
    try {
      await this.querySchedule({
        ownerUserId: "health-check",
        timeZone: this.config.defaultTimeZone,
        windowStart: new Date(),
        windowEnd: new Date(Date.now() + 60_000),
        slotMinutes: this.config.slotMinutes
      });
      return {
        provider: "MICROSOFT",
        status: "CONFIGURED",
        configured: true,
        checkedAt: new Date().toISOString(),
        defaultTimeZone: this.config.defaultTimeZone,
        missingConfig: [],
        lastError: null
      };
    } catch (error) {
      return {
        provider: "MICROSOFT",
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
    const missingConfig = missingMicrosoftConfig(this.config);
    if (missingConfig.length > 0) {
      return {
        ...baseAvailability(
          "MICROSOFT",
          input,
          `Microsoft Calendar is missing required configuration: ${missingConfig.join(", ")}`
        ),
        status: "NOT_CONFIGURED"
      };
    }
    try {
      const busy = await this.querySchedule(input);
      return {
        provider: "MICROSOFT",
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
      return toErrorAvailability("MICROSOFT", input, sanitizeError(error));
    }
  }

  public async createMeeting(
    input: CalendarMeetingCreateInput
  ): Promise<CalendarMeetingCreateResult> {
    const missingConfig = [
      ...missingMicrosoftConfig(this.config),
      ...(input.meetingMode === undefined || input.meetingMode === "VIDEO" ? missingZoomConfig(this.config) : [])
    ];
    if (missingConfig.length > 0) {
      return {
        provider: "MICROSOFT",
        status: "NOT_CONFIGURED",
        externalMeetingId: null,
        externalMeetingUrl: null,
        externalCalendarId: null,
        organizerEmail: null,
        lastError: `Microsoft Calendar meeting creation is missing required configuration: ${missingConfig.join(", ")}`
      };
    }

    try {
      const token = await this.getAccessToken();
      const zoom =
        this.config.conferenceProvider === "zoom" && (input.meetingMode === undefined || input.meetingMode === "VIDEO")
          ? await new ZoomConferenceProvider(this.config, this.transport).createMeeting(input)
          : null;
      const response = await this.requestWithRetry(
        `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(this.config.microsoft.userId)}/events`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token.accessToken}`,
            "Content-Type": "application/json",
            Prefer: 'outlook.timezone="UTC"'
          },
          body: JSON.stringify({
            subject: input.title,
            body: {
              contentType: "text",
              content: zoom
                ? appendConferenceLink(input.description, "Join Zoom meeting", zoom.joinUrl)
                : (input.description ?? "")
            },
            start: { dateTime: input.startsAt.toISOString(), timeZone: "UTC" },
            end: { dateTime: input.endsAt.toISOString(), timeZone: "UTC" },
            attendees: input.attendees.map((address) => ({
              emailAddress: { address },
              type: "required"
            })),
            transactionId: createHash("sha256").update(input.idempotencyKey).digest("hex"),
            location: input.location ? { displayName: input.location } : undefined,
            isOnlineMeeting: this.config.conferenceProvider === "native" && (input.meetingMode === undefined || input.meetingMode === "VIDEO"),
            onlineMeetingProvider:
              this.config.conferenceProvider === "native" && (input.meetingMode === undefined || input.meetingMode === "VIDEO") ? "teamsForBusiness" : undefined
          })
        }
      );
      const rawBody: unknown = await response.json().catch(() => null);
      const created = microsoftEventResponseSchema.safeParse(rawBody);
      if (!response.ok || !created.success) {
        throw new Error(
          `Microsoft Graph event creation failed with status ${String(response.status)}`
        );
      }

      const verified = await this.getEventById(token.accessToken, created.data.id);
      return {
        provider: "MICROSOFT",
        status: "SYNCED",
        externalMeetingId: verified.id,
        externalMeetingUrl: zoom?.joinUrl ?? verified.onlineMeeting?.joinUrl ?? verified.webLink,
        externalCalendarId: this.config.microsoft.userId,
        organizerEmail: verified.organizer?.emailAddress.address ?? zoom?.hostEmail ?? null,
        lastError: null
      };
    } catch (error) {
      return {
        provider: "MICROSOFT",
        status: "FAILED",
        externalMeetingId: null,
        externalMeetingUrl: null,
        externalCalendarId: null,
        organizerEmail: null,
        lastError: sanitizeError(error)
      };
    }
  }

  private async querySchedule(
    input: CalendarAvailabilityInput
  ): Promise<{ start: Date; end: Date }[]> {
    const token = await this.getAccessToken();
    const response = await this.requestWithRetry(
      `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(this.config.microsoft.userId)}/calendar/getSchedule`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token.accessToken}`,
          "Content-Type": "application/json",
          Prefer: 'outlook.timezone="UTC"'
        },
        body: JSON.stringify({
          schedules: [this.config.microsoft.userId],
          startTime: { dateTime: input.windowStart.toISOString(), timeZone: "UTC" },
          endTime: { dateTime: input.windowEnd.toISOString(), timeZone: "UTC" },
          availabilityViewInterval: input.slotMinutes
        })
      }
    );
    const rawBody: unknown = await response.json().catch(() => null);
    const parsed = microsoftScheduleResponseSchema.safeParse(rawBody);
    if (!response.ok || !parsed.success || !parsed.data.value[0]) {
      throw new Error(
        `Microsoft Graph schedule request failed with status ${String(response.status)}`
      );
    }
    return parsed.data.value[0].scheduleItems.map((item) => ({
      start: parseMicrosoftDateTime(item.start.dateTime),
      end: parseMicrosoftDateTime(item.end.dateTime)
    }));
  }

  private async getEventById(accessToken: string, eventId: string) {
    const response = await this.requestWithRetry(
      `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(this.config.microsoft.userId)}/events/${encodeURIComponent(eventId)}`,
      { method: "GET", headers: { Authorization: `Bearer ${accessToken}` } }
    );
    const rawBody: unknown = await response.json().catch(() => null);
    const parsed = microsoftEventResponseSchema.safeParse(rawBody);
    if (!response.ok || !parsed.success || parsed.data.isCancelled) {
      throw new Error(
        `Microsoft Graph event verification failed with status ${String(response.status)}`
      );
    }
    return parsed.data;
  }

  private async getAccessToken(): Promise<MicrosoftAccessToken> {
    if (this.cachedToken && this.cachedToken.expiresAt > new Date(Date.now() + 120_000)) {
      return this.cachedToken;
    }
    const response = await this.requestWithRetry(
      `https://login.microsoftonline.com/${encodeURIComponent(this.config.microsoft.tenantId)}/oauth2/v2.0/token`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: this.config.microsoft.clientId,
          client_secret: this.config.microsoft.clientSecret,
          scope: "https://graph.microsoft.com/.default",
          grant_type: "client_credentials"
        })
      }
    );
    const rawBody: unknown = await response.json().catch(() => null);
    const parsed = microsoftTokenResponseSchema.safeParse(rawBody);
    if (!response.ok || !parsed.success || !parsed.data.access_token || !parsed.data.expires_in) {
      throw new Error(`Microsoft OAuth failed with status ${String(response.status)}`);
    }
    this.cachedToken = {
      accessToken: parsed.data.access_token,
      expiresAt: new Date(Date.now() + parsed.data.expires_in * 1000)
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
        if (!isRetryableStatus(response.status) || attempt === this.config.maxRetries)
          return response;
      } catch {
        clearTimeout(timeout);
        if (attempt === this.config.maxRetries) break;
      }
      await sleep(250 * (attempt + 1));
    }
    throw new Error("Microsoft Calendar request failed after retries");
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
      externalCalendarId: null,
      organizerEmail: null,
      lastError: "Provider-specific calendar adapter is not implemented in R21"
    });
  }

  public cancelMeeting(): Promise<{ status: "FAILED"; lastError: string }> {
    return Promise.resolve({ status: "FAILED", lastError: "Calendar cancellation is unavailable for this provider" });
  }

  public rescheduleMeeting(): Promise<{ status: "FAILED"; lastError: string }> {
    return Promise.resolve({ status: "FAILED", lastError: "Calendar rescheduling is unavailable for this provider" });
  }
}

export function createCalendarProvider(config: CalendarConfig): CalendarProvider {
  if (config.provider === "none") {
    return new NotConfiguredCalendarProvider(config);
  }

  if (config.provider === "google") {
    return new GoogleCalendarProvider(config);
  }

  return new MicrosoftCalendarProvider(config);
}
