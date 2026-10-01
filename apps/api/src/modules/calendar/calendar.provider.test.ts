import { describe, expect, it } from "vitest";
import type { CalendarConfig } from "@shilabs/shared-config";
import {
  GoogleCalendarProvider,
  NotConfiguredCalendarProvider,
  UnsupportedCalendarProvider,
  type CalendarTransport
} from "./calendar.provider.js";

function buildConfig(overrides: Partial<CalendarConfig> = {}): CalendarConfig {
  return {
    provider: "none",
    defaultTimeZone: "Asia/Kolkata",
    workdayStart: "09:00",
    workdayEnd: "17:00",
    slotMinutes: 30,
    lookaheadDays: 14,
    timeoutMs: 1000,
    maxRetries: 0,
    google: {
      clientId: "",
      clientSecret: "",
      refreshToken: "",
      calendarId: "",
      scope: "https://www.googleapis.com/auth/calendar.freebusy"
    },
    microsoft: {
      tenantId: "",
      clientId: "",
      clientSecret: "",
      userId: ""
    },
    ...overrides
  };
}

const availabilityInput = {
  ownerUserId: "cmcalendarprovider000000000001",
  timeZone: "Asia/Kolkata",
  windowStart: new Date("2026-09-23T04:00:00.000Z"),
  windowEnd: new Date("2026-09-23T06:00:00.000Z"),
  slotMinutes: 30
};

function buildGoogleConfig(): CalendarConfig {
  return buildConfig({
    provider: "google",
    google: {
      clientId: "client-id",
      clientSecret: "client-secret",
      refreshToken: "refresh-token",
      calendarId: "primary",
      scope:
        "https://www.googleapis.com/auth/calendar.freebusy https://www.googleapis.com/auth/calendar.events"
    }
  });
}

function parseJsonBody(body: unknown): Record<string, unknown> {
  if (typeof body !== "string") {
    throw new Error("Expected JSON request body");
  }

  const parsed = JSON.parse(body) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Expected JSON object request body");
  }

  return parsed as Record<string, unknown>;
}

describe("calendar provider foundation", () => {
  it("reports truthful NOT_CONFIGURED health and no fake availability", async () => {
    const provider = new NotConfiguredCalendarProvider(buildConfig());

    await expect(provider.getHealth()).resolves.toMatchObject({
      provider: "NONE",
      status: "NOT_CONFIGURED",
      configured: false,
      missingConfig: ["CALENDAR_PROVIDER"]
    });

    await expect(provider.getAvailability(availabilityInput)).resolves.toMatchObject({
      provider: "NONE",
      status: "NOT_CONFIGURED",
      slots: [],
      unavailableReason: "Calendar provider is not configured"
    });
  });

  it("keeps unsupported provider selections behind the provider boundary", async () => {
    const provider = new UnsupportedCalendarProvider(buildConfig({ provider: "microsoft" }));

    await expect(provider.getHealth()).resolves.toMatchObject({
      provider: "MICROSOFT",
      status: "ERROR",
      configured: false,
      lastError: "Provider-specific calendar adapter is not implemented in R20"
    });

    await expect(provider.getAvailability(availabilityInput)).resolves.toMatchObject({
      provider: "MICROSOFT",
      status: "ERROR",
      slots: [],
      unavailableReason: "Provider-specific calendar adapter is not implemented in R20"
    });
  });

  it("uses Google OAuth refresh token and FreeBusy to compute available slots", async () => {
    const calls: string[] = [];
    const transport: CalendarTransport = (url) => {
      const requestUrl = url instanceof Request ? url.url : String(url);
      calls.push(requestUrl);
      if (requestUrl === "https://oauth2.googleapis.com/token") {
        return Promise.resolve(
          Response.json({
            access_token: "test-access-token",
            expires_in: 3600,
            scope: "https://www.googleapis.com/auth/calendar.freebusy",
            token_type: "Bearer"
          })
        );
      }

      return Promise.resolve(
        Response.json({
          calendars: {
            primary: {
              busy: [
                {
                  start: "2026-09-23T04:00:00.000Z",
                  end: "2026-09-23T04:30:00.000Z"
                }
              ]
            }
          }
        })
      );
    };
    const provider = new GoogleCalendarProvider(
      buildConfig({
        provider: "google",
        google: {
          clientId: "client-id",
          clientSecret: "client-secret",
          refreshToken: "refresh-token",
          calendarId: "primary",
          scope: "https://www.googleapis.com/auth/calendar.freebusy"
        }
      }),
      transport
    );

    const result = await provider.getAvailability(availabilityInput);

    expect(calls).toEqual([
      "https://oauth2.googleapis.com/token",
      "https://www.googleapis.com/calendar/v3/freeBusy"
    ]);
    expect(result).toMatchObject({
      provider: "GOOGLE",
      status: "AVAILABLE",
      unavailableReason: null
    });
    expect(result.slots).toEqual([
      {
        startsAt: "2026-09-23T04:30:00.000Z",
        endsAt: "2026-09-23T05:00:00.000Z",
        timeZone: "Asia/Kolkata"
      },
      {
        startsAt: "2026-09-23T05:00:00.000Z",
        endsAt: "2026-09-23T05:30:00.000Z",
        timeZone: "Asia/Kolkata"
      },
      {
        startsAt: "2026-09-23T05:30:00.000Z",
        endsAt: "2026-09-23T06:00:00.000Z",
        timeZone: "Asia/Kolkata"
      }
    ]);
  });

  it("reports Google configuration gaps without calling the provider", async () => {
    const provider = new GoogleCalendarProvider(buildConfig({ provider: "google" }));

    await expect(provider.getHealth()).resolves.toMatchObject({
      provider: "GOOGLE",
      status: "NOT_CONFIGURED",
      configured: false,
      missingConfig: [
        "GOOGLE_CALENDAR_CLIENT_ID",
        "GOOGLE_CALENDAR_CLIENT_SECRET",
        "GOOGLE_CALENDAR_REFRESH_TOKEN",
        "GOOGLE_CALENDAR_ID"
      ]
    });
  });

  it("returns truthful ERROR state when Google FreeBusy fails", async () => {
    const transport: CalendarTransport = (url) => {
      const requestUrl = url instanceof Request ? url.url : String(url);
      if (requestUrl === "https://oauth2.googleapis.com/token") {
        return Promise.resolve(
          Response.json({
            access_token: "test-access-token",
            expires_in: 3600,
            scope: "https://www.googleapis.com/auth/calendar.freebusy",
            token_type: "Bearer"
          })
        );
      }

      return Promise.resolve(
        Response.json({ error: { message: "provider failed" } }, { status: 500 })
      );
    };
    const provider = new GoogleCalendarProvider(
      buildConfig({
        provider: "google",
        google: {
          clientId: "client-id",
          clientSecret: "client-secret",
          refreshToken: "refresh-token",
          calendarId: "primary",
          scope: "https://www.googleapis.com/auth/calendar.freebusy"
        }
      }),
      transport
    );

    await expect(provider.getAvailability(availabilityInput)).resolves.toMatchObject({
      provider: "GOOGLE",
      status: "ERROR",
      slots: [],
      unavailableReason:
        "Google Calendar FreeBusy failed with status 500: provider failed"
    });
  });

  it("persists sanitized Google event insert error details without leaking tokens", async () => {
    const calls: { url: string; body: unknown }[] = [];
    const transport: CalendarTransport = (url, init) => {
      const requestUrl = url instanceof Request ? url.url : String(url);
      calls.push({
        url: requestUrl,
        body: init?.body
      });
      if (requestUrl === "https://oauth2.googleapis.com/token") {
        return Promise.resolve(
          Response.json({
            access_token: "test-access-token",
            expires_in: 3600,
            scope:
              "https://www.googleapis.com/auth/calendar.freebusy https://www.googleapis.com/auth/calendar.events",
            token_type: "Bearer"
          })
        );
      }

      return Promise.resolve(
        Response.json(
          {
            error: {
              code: 400,
              message: "Invalid resource id value.",
              status: "INVALID_ARGUMENT",
              errors: [
                {
                  domain: "global",
                  reason: "invalid",
                  message: "Invalid resource id value."
                }
              ]
            }
          },
          { status: 400 }
        )
      );
    };
    const provider = new GoogleCalendarProvider(buildGoogleConfig(), transport);

    const result = await provider.createMeeting({
      idempotencyKey: "meeting:cmudtc72z00015aucb3mok50n",
      title: "Meeting with E2E Customer02",
      startsAt: new Date("2026-09-24T08:59:00.000Z"),
      endsAt: new Date("2026-09-24T09:29:00.000Z"),
      timeZone: "Asia/Calcutta",
      attendees: ["customer02@example.com"]
    });

    expect(calls.map((call) => call.url)).toEqual([
      "https://oauth2.googleapis.com/token",
      "https://www.googleapis.com/calendar/v3/calendars/primary/events?sendUpdates=none"
    ]);
    const eventBody = parseJsonBody(calls[1]?.body);
    expect(eventBody.id).toMatch(/^[a-v0-9]+$/);
    expect(eventBody.id).not.toContain("z");
    expect(result).toMatchObject({
      provider: "GOOGLE",
      status: "FAILED",
      externalMeetingId: null,
      lastError:
        "Google Calendar event insert failed with status 400: code 400; status INVALID_ARGUMENT; reason invalid; Invalid resource id value."
    });
    expect(result.lastError).not.toContain("test-access-token");
    expect(result.lastError).not.toContain("refresh-token");
  });

  it("uses a deterministic Google-valid event id for repeated meeting creation attempts", async () => {
    const eventIds: string[] = [];
    const transport: CalendarTransport = (url, init) => {
      const requestUrl = url instanceof Request ? url.url : String(url);
      if (requestUrl === "https://oauth2.googleapis.com/token") {
        return Promise.resolve(
          Response.json({
            access_token: "test-access-token",
            expires_in: 3600,
            scope:
              "https://www.googleapis.com/auth/calendar.freebusy https://www.googleapis.com/auth/calendar.events",
            token_type: "Bearer"
          })
        );
      }

      if (requestUrl.includes("/events/")) {
        const eventId = decodeURIComponent(requestUrl.split("/events/")[1] ?? "");
        return Promise.resolve(
          Response.json({
            id: eventId,
            status: "confirmed",
            htmlLink: `https://calendar.google.test/verified/${eventId}`,
            organizer: { email: "calendar-owner@example.test" }
          })
        );
      }

      const eventBody = parseJsonBody(init?.body);
      const eventId = String(eventBody.id);
      eventIds.push(eventId);
      return Promise.resolve(
        Response.json({
          id: eventId,
          htmlLink: `https://calendar.google.test/insert/${eventId}`
        })
      );
    };
    const provider = new GoogleCalendarProvider(buildGoogleConfig(), transport);
    const input = {
      idempotencyKey: "meeting:cmudtc72z00015aucb3mok50n",
      title: "Meeting with E2E Customer02",
      startsAt: new Date("2026-09-24T08:59:00.000Z"),
      endsAt: new Date("2026-09-24T09:29:00.000Z"),
      timeZone: "Asia/Kolkata",
      attendees: ["customer02@example.com"]
    };

    const first = await provider.createMeeting(input);
    const second = await provider.createMeeting(input);

    expect(eventIds).toHaveLength(2);
    expect(eventIds[0]).toBe(eventIds[1]);
    expect(eventIds[0]).toMatch(/^meeting[a-f0-9]{64}$/);
    expect(eventIds[0]).toMatch(/^[a-v0-9]+$/);
    const eventId = eventIds[0];
    if (!eventId) {
      throw new Error("Expected deterministic Google event id");
    }
    expect(first).toMatchObject({
      provider: "GOOGLE",
      status: "SYNCED",
      externalMeetingId: eventId,
      externalMeetingUrl: `https://calendar.google.test/verified/${eventId}`,
      externalCalendarId: "primary",
      organizerEmail: "calendar-owner@example.test"
    });
    expect(second).toMatchObject({
      provider: "GOOGLE",
      status: "SYNCED",
      externalMeetingId: eventId,
      externalMeetingUrl: `https://calendar.google.test/verified/${eventId}`,
      externalCalendarId: "primary",
      organizerEmail: "calendar-owner@example.test"
    });
  });

  it("creates different deterministic Google event ids for different idempotency keys", async () => {
    const eventIds: string[] = [];
    const transport: CalendarTransport = (url, init) => {
      const requestUrl = url instanceof Request ? url.url : String(url);
      if (requestUrl === "https://oauth2.googleapis.com/token") {
        return Promise.resolve(
          Response.json({
            access_token: "test-access-token",
            expires_in: 3600,
            scope:
              "https://www.googleapis.com/auth/calendar.freebusy https://www.googleapis.com/auth/calendar.events",
            token_type: "Bearer"
          })
        );
      }

      if (requestUrl.includes("/events/")) {
        const eventId = decodeURIComponent(requestUrl.split("/events/")[1] ?? "");
        return Promise.resolve(
          Response.json({
            id: eventId,
            status: "confirmed",
            htmlLink: `https://calendar.google.test/verified/${eventId}`,
            organizer: { email: "calendar-owner@example.test" }
          })
        );
      }

      const eventBody = parseJsonBody(init?.body);
      const eventId = String(eventBody.id);
      eventIds.push(eventId);
      return Promise.resolve(Response.json({ id: eventId, htmlLink: `https://calendar.google.test/insert/${eventId}` }));
    };
    const provider = new GoogleCalendarProvider(buildGoogleConfig(), transport);
    const baseInput = {
      title: "R21 test meeting",
      startsAt: new Date("2026-09-24T08:59:00.000Z"),
      endsAt: new Date("2026-09-24T09:29:00.000Z"),
      timeZone: "Asia/Kolkata",
      attendees: ["customer02@example.com"]
    };

    await provider.createMeeting({ ...baseInput, idempotencyKey: "meeting:first" });
    await provider.createMeeting({ ...baseInput, idempotencyKey: "meeting:second" });

    expect(eventIds).toHaveLength(2);
    expect(eventIds[0]).not.toBe(eventIds[1]);
    expect(eventIds.every((eventId) => /^[a-v0-9]+$/.test(eventId))).toBe(true);
  });

  it("does not create Google meetings without the event-write scope", async () => {
    const provider = new GoogleCalendarProvider(
      buildConfig({
        provider: "google",
        google: {
          clientId: "client-id",
          clientSecret: "client-secret",
          refreshToken: "refresh-token",
          calendarId: "primary",
          scope: "https://www.googleapis.com/auth/calendar.freebusy"
        }
      })
    );

    await expect(
      provider.createMeeting({
        idempotencyKey: "meeting-test-idempotency",
        title: "R21 test meeting",
        startsAt: new Date("2026-09-23T04:00:00.000Z"),
        endsAt: new Date("2026-09-23T04:30:00.000Z"),
        timeZone: "Asia/Kolkata",
        attendees: ["customer@example.local"]
      })
    ).resolves.toMatchObject({
      provider: "GOOGLE",
      status: "NOT_CONFIGURED",
      externalMeetingId: null,
      lastError:
        "Google Calendar meeting creation is missing required configuration: GOOGLE_CALENDAR_SCOPE_EVENTS"
    });
  });
});
