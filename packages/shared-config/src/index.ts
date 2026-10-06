import crypto from "node:crypto";

export interface ApiConfig {
  host: string;
  port: number;
  nodeEnv: string;
  webOrigin: string;
  realtimeInternalSecret: string;
  trustProxy: false | string | number;
  jsonBodyLimit: string;
  webhookBodyLimit: string;
  globalRateLimitWindowMs: number;
  globalRateLimitMax: number;
  webhookRateLimitWindowMs: number;
  webhookRateLimitMax: number;
}

export interface WorkerConfig {
  redisUrl: string;
  nodeEnv: string;
  apiBaseUrl: string;
  realtimeInternalSecret: string;
  domainEventQueueName: string;
  domainEventWorkerConcurrency: number;
  domainEventDispatchLimit: number;
  domainEventDispatchIntervalMs: number;
  domainEventStaleAfterMs: number;
  domainEventQueuedStaleAfterMs: number;
}

export interface AuthConfig {
  jwtSecret: string;
  accessTokenTtlSeconds: number;
  bcryptSaltRounds: number;
}

export type CalendarProviderName = "none" | "google" | "microsoft";
export type VoiceProviderName = "none" | "twilio" | "exotel";
export type MessagingProviderName = "none" | "meta_whatsapp" | "twilio_whatsapp";

export interface CalendarConfig {
  provider: CalendarProviderName;
  defaultTimeZone: string;
  workdayStart: string;
  workdayEnd: string;
  slotMinutes: number;
  lookaheadDays: number;
  timeoutMs: number;
  maxRetries: number;
  google: {
    clientId: string;
    clientSecret: string;
    refreshToken: string;
    calendarId: string;
    scope: string;
  };
  microsoft: {
    tenantId: string;
    clientId: string;
    clientSecret: string;
    userId: string;
  };
}

export interface VoiceConfig {
  provider: VoiceProviderName;
  nodeEnv: string;
  webhookBaseUrl: string;
  defaultRegion: string;
  defaultAccent: string;
  recordingEnabled: boolean;
  transcriptionEnabled: boolean;
  productionCallingEnabled: boolean;
  complianceConsentMode: "disabled" | "development" | "confirmed";
  e2eAllowedToNumbers: string[];
  timeoutMs: number;
  maxRetries: number;
  twilio: {
    accountSid: string;
    authToken: string;
    fromNumber: string;
    statusCallbackPath: string;
    recordingCallbackPath: string;
  };
  exotel: {
    accountSid: string;
    apiKey: string;
    apiToken: string;
    apiSubdomain: string;
    callerId: string;
    appUrl: string;
    agentNumber: string;
    statusCallbackPath: string;
    voicebotAppPath: string;
    voicebotStreamPath: string;
    webhookSecret: string;
  };
  voiceAi: {
    enabled: boolean;
    provider: "openai_realtime" | "local_vosk_windows";
    openaiApiKey: string;
    model: string;
    voice: string;
    sampleRate: 16000 | 24000;
    streamToken: string;
    streamTokenTtlSeconds: number;
    localVoskModelPath: string;
    localPythonCommand: string;
    localTtsVoiceName: string;
  };
}

export interface CallingAutomationConfig {
  enabled: boolean;
  attemptsSameDay: number;
  sameDaySpacingMinutes: number;
  waitDaysAfterSameDay: number;
  maxAttempts: number;
}

export type FollowUpCadenceMode = "production_days" | "e2e_accelerated_minutes";

export interface FollowUpTimingConfig {
  mode: FollowUpCadenceMode;
  nodeEnv: string;
  appEnv: string;
  productionCadenceDays: number[];
  offsetsMinutes: number[];
}

export interface MessagingConfig {
  provider: MessagingProviderName;
  nodeEnv: string;
  webhookBaseUrl: string;
  templatePolicyMode: "unresolved" | "approved_only";
  e2eAllowedToNumbers: string[];
  timeoutMs: number;
  maxRetries: number;
  metaWhatsApp: {
    graphApiBaseUrl: string;
    accessToken: string;
    phoneNumberId: string;
    businessAccountId: string;
    appSecret: string;
    webhookVerifyToken: string;
    defaultTemplateName: string;
    defaultTemplateLanguage: string;
  };
  twilioWhatsApp: {
    accountSid: string;
    authToken: string;
    sandboxFrom: string;
    contentSid: string;
    defaultBody: string;
  };
}

export function getApiConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  return {
    host: env.API_HOST ?? "0.0.0.0",
    port: Number(env.API_PORT ?? 4000),
    nodeEnv: env.NODE_ENV ?? "development",
    webOrigin: env.WEB_ORIGIN ?? "http://localhost:5173",
    realtimeInternalSecret: env.REALTIME_INTERNAL_SECRET ?? "",
    trustProxy: parseTrustProxy(env.API_TRUST_PROXY),
    jsonBodyLimit: env.API_JSON_BODY_LIMIT ?? "1mb",
    webhookBodyLimit: env.API_WEBHOOK_BODY_LIMIT ?? "512kb",
    globalRateLimitWindowMs: Number(env.API_GLOBAL_RATE_LIMIT_WINDOW_MS ?? 15 * 60 * 1000),
    globalRateLimitMax: Number(env.API_GLOBAL_RATE_LIMIT_MAX ?? 1000),
    webhookRateLimitWindowMs: Number(env.API_WEBHOOK_RATE_LIMIT_WINDOW_MS ?? 60 * 1000),
    webhookRateLimitMax: Number(env.API_WEBHOOK_RATE_LIMIT_MAX ?? 120)
  };
}

export function getWorkerConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  const domainEventDispatchIntervalMs = Number(env.DOMAIN_EVENT_DISPATCH_INTERVAL_MS ?? 60000);
  const domainEventStaleAfterMs = Number(env.DOMAIN_EVENT_STALE_AFTER_MS ?? 900000);
  const defaultQueuedStaleAfterMs = Math.min(
    domainEventStaleAfterMs,
    Math.max(domainEventDispatchIntervalMs * 2, 30000)
  );
  return {
    redisUrl: env.REDIS_URL ?? "",
    nodeEnv: env.NODE_ENV ?? "development",
    apiBaseUrl:
      env.WORKER_API_BASE_URL ??
      env.API_BASE_URL ??
      `http://localhost:${String(Number(env.API_PORT ?? 4000))}`,
    realtimeInternalSecret: env.REALTIME_INTERNAL_SECRET ?? "",
    domainEventQueueName: env.DOMAIN_EVENT_QUEUE_NAME ?? "domain-events",
    domainEventWorkerConcurrency: Number(env.DOMAIN_EVENT_WORKER_CONCURRENCY ?? 5),
    domainEventDispatchLimit: Number(env.DOMAIN_EVENT_DISPATCH_LIMIT ?? 25),
    domainEventDispatchIntervalMs,
    domainEventStaleAfterMs,
    domainEventQueuedStaleAfterMs: Number(
      env.DOMAIN_EVENT_QUEUED_STALE_AFTER_MS ?? defaultQueuedStaleAfterMs
    )
  };
}

function parseCalendarProvider(value: string | undefined): CalendarProviderName {
  const provider = (value ?? "none").trim().toLowerCase();
  if (provider === "" || provider === "none") {
    return "none";
  }
  if (provider === "google" || provider === "microsoft") {
    return provider;
  }

  throw new Error("CALENDAR_PROVIDER must be one of: none, google, microsoft");
}

function parseVoiceProvider(value: string | undefined): VoiceProviderName {
  const provider = (value ?? "none").trim().toLowerCase();
  if (provider === "" || provider === "none") {
    return "none";
  }
  if (provider === "twilio" || provider === "exotel") {
    return provider;
  }

  throw new Error("VOICE_PROVIDER must be one of: none, twilio, exotel");
}

function parseMessagingProvider(value: string | undefined): MessagingProviderName {
  const provider = (value ?? "none").trim().toLowerCase();
  if (provider === "" || provider === "none") {
    return "none";
  }
  if (provider === "meta_whatsapp" || provider === "meta-whatsapp" || provider === "whatsapp") {
    return "meta_whatsapp";
  }
  if (provider === "twilio_whatsapp" || provider === "twilio-whatsapp" || provider === "twilio") {
    return "twilio_whatsapp";
  }

  throw new Error("MESSAGING_PROVIDER must be one of: none, meta_whatsapp, twilio_whatsapp");
}

function parseTemplatePolicyMode(value: string | undefined): MessagingConfig["templatePolicyMode"] {
  const mode = (value ?? "unresolved").trim().toLowerCase();
  if (mode === "unresolved" || mode === "approved_only") {
    return mode;
  }

  throw new Error("WHATSAPP_TEMPLATE_POLICY_MODE must be one of: unresolved, approved_only");
}

function parseBooleanEnv(name: string, value: string | undefined, defaultValue: boolean): boolean {
  const normalized = (value ?? String(defaultValue)).trim().toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  throw new Error(`${name} must be true or false`);
}

function parseConsentMode(value: string | undefined): VoiceConfig["complianceConsentMode"] {
  const mode = (value ?? "disabled").trim().toLowerCase();
  if (mode === "disabled" || mode === "development" || mode === "confirmed") {
    return mode;
  }

  throw new Error("VOICE_COMPLIANCE_CONSENT_MODE must be one of: disabled, development, confirmed");
}

function parseCsv(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseTrustProxy(value: string | undefined): false | string | number {
  const raw = (value ?? "loopback").trim();
  if (raw.toLowerCase() === "false" || raw.length === 0) return false;
  const hopCount = Number(raw);
  if (Number.isInteger(hopCount) && hopCount >= 0) return hopCount;
  return raw;
}

function parseNumberCsv(name: string, value: string | undefined, defaultValue: number[]): number[] {
  const raw = value?.trim();
  const values =
    raw && raw.length > 0 ? raw.split(",").map((item) => Number(item.trim())) : defaultValue;
  if (
    values.length === 0 ||
    values.some((item) => !Number.isInteger(item) || item < 0 || item > 1440)
  ) {
    throw new Error(`${name} must be a comma-separated list of integers between 0 and 1440`);
  }

  return values;
}

function parseFollowUpCadenceMode(value: string | undefined): FollowUpCadenceMode {
  const mode = (value ?? "production_days").trim().toLowerCase();
  if (mode === "production_days" || mode === "e2e_accelerated_minutes") {
    return mode;
  }

  throw new Error(
    "FOLLOW_UP_CADENCE_MODE must be one of: production_days, e2e_accelerated_minutes"
  );
}

function assertTimeZone(timeZone: string): void {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date());
  } catch {
    throw new Error("CALENDAR_DEFAULT_TIME_ZONE must be a valid IANA time zone");
  }
}

function assertClockTime(name: string, value: string): void {
  if (!/^\d{2}:\d{2}$/.test(value)) {
    throw new Error(`${name} must use HH:mm format`);
  }

  const [hoursText, minutesText] = value.split(":");
  const hours = Number(hoursText);
  const minutes = Number(minutesText);
  if (hours > 23 || minutes > 59) {
    throw new Error(`${name} must be a valid 24-hour clock time`);
  }
}

export function getCalendarConfig(env: NodeJS.ProcessEnv = process.env): CalendarConfig {
  const defaultTimeZone = env.CALENDAR_DEFAULT_TIME_ZONE ?? "Asia/Kolkata";
  const workdayStart = env.CALENDAR_WORKDAY_START ?? "09:00";
  const workdayEnd = env.CALENDAR_WORKDAY_END ?? "17:00";
  const slotMinutes = Number(env.CALENDAR_SLOT_MINUTES ?? 30);
  const lookaheadDays = Number(env.CALENDAR_LOOKAHEAD_DAYS ?? 14);
  const timeoutMs = Number(env.CALENDAR_TIMEOUT_MS ?? 30000);
  const maxRetries = Number(env.CALENDAR_MAX_RETRIES ?? 1);

  assertTimeZone(defaultTimeZone);
  assertClockTime("CALENDAR_WORKDAY_START", workdayStart);
  assertClockTime("CALENDAR_WORKDAY_END", workdayEnd);

  if (!Number.isInteger(slotMinutes) || slotMinutes < 15 || slotMinutes > 240) {
    throw new Error("CALENDAR_SLOT_MINUTES must be an integer between 15 and 240");
  }

  if (!Number.isInteger(lookaheadDays) || lookaheadDays < 1 || lookaheadDays > 90) {
    throw new Error("CALENDAR_LOOKAHEAD_DAYS must be an integer between 1 and 90");
  }

  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 120000) {
    throw new Error("CALENDAR_TIMEOUT_MS must be an integer between 1000 and 120000");
  }

  if (!Number.isInteger(maxRetries) || maxRetries < 0 || maxRetries > 5) {
    throw new Error("CALENDAR_MAX_RETRIES must be an integer between 0 and 5");
  }

  return {
    provider: parseCalendarProvider(env.CALENDAR_PROVIDER),
    defaultTimeZone,
    workdayStart,
    workdayEnd,
    slotMinutes,
    lookaheadDays,
    timeoutMs,
    maxRetries,
    google: {
      clientId: env.GOOGLE_CALENDAR_CLIENT_ID ?? "",
      clientSecret: env.GOOGLE_CALENDAR_CLIENT_SECRET ?? "",
      refreshToken: env.GOOGLE_CALENDAR_REFRESH_TOKEN ?? "",
      calendarId: env.GOOGLE_CALENDAR_ID ?? "",
      scope: env.GOOGLE_CALENDAR_SCOPE ?? "https://www.googleapis.com/auth/calendar.freebusy"
    },
    microsoft: {
      tenantId: env.MICROSOFT_CALENDAR_TENANT_ID ?? "",
      clientId: env.MICROSOFT_CALENDAR_CLIENT_ID ?? "",
      clientSecret: env.MICROSOFT_CALENDAR_CLIENT_SECRET ?? "",
      userId: env.MICROSOFT_CALENDAR_USER_ID ?? ""
    }
  };
}

export function getVoiceConfig(env: NodeJS.ProcessEnv = process.env): VoiceConfig {
  const timeoutMs = Number(env.VOICE_TIMEOUT_MS ?? 30000);
  const maxRetries = Number(env.VOICE_MAX_RETRIES ?? 1);
  const streamTokenTtlSeconds = Number(env.VOICE_AI_STREAM_TOKEN_TTL_SECONDS ?? 300);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 120000) {
    throw new Error("VOICE_TIMEOUT_MS must be an integer between 1000 and 120000");
  }
  if (!Number.isInteger(maxRetries) || maxRetries < 0 || maxRetries > 5) {
    throw new Error("VOICE_MAX_RETRIES must be an integer between 0 and 5");
  }
  if (
    !Number.isInteger(streamTokenTtlSeconds) ||
    streamTokenTtlSeconds < 30 ||
    streamTokenTtlSeconds > 3600
  ) {
    throw new Error("VOICE_AI_STREAM_TOKEN_TTL_SECONDS must be an integer between 30 and 3600");
  }

  return {
    provider: parseVoiceProvider(env.VOICE_PROVIDER),
    nodeEnv: env.NODE_ENV ?? "development",
    webhookBaseUrl: env.VOICE_WEBHOOK_BASE_URL ?? "",
    defaultRegion: env.VOICE_DEFAULT_REGION ?? "IN",
    defaultAccent: env.VOICE_DEFAULT_ACCENT ?? "indian-english",
    recordingEnabled: parseBooleanEnv(
      "VOICE_RECORDING_ENABLED",
      env.VOICE_RECORDING_ENABLED,
      false
    ),
    transcriptionEnabled: parseBooleanEnv(
      "VOICE_TRANSCRIPTION_ENABLED",
      env.VOICE_TRANSCRIPTION_ENABLED,
      false
    ),
    productionCallingEnabled: parseBooleanEnv(
      "VOICE_PRODUCTION_CALLING_ENABLED",
      env.VOICE_PRODUCTION_CALLING_ENABLED,
      false
    ),
    complianceConsentMode: parseConsentMode(env.VOICE_COMPLIANCE_CONSENT_MODE),
    e2eAllowedToNumbers: parseCsv(env.VOICE_E2E_ALLOWED_TO_NUMBERS),
    timeoutMs,
    maxRetries,
    twilio: {
      accountSid: env.TWILIO_ACCOUNT_SID ?? "",
      authToken: env.TWILIO_AUTH_TOKEN ?? "",
      fromNumber: env.TWILIO_FROM_NUMBER ?? "",
      statusCallbackPath: env.TWILIO_STATUS_CALLBACK_PATH ?? "/api/voice/twilio/status",
      recordingCallbackPath: env.TWILIO_RECORDING_CALLBACK_PATH ?? "/api/voice/twilio/recording"
    },
    exotel: {
      accountSid: env.EXOTEL_ACCOUNT_SID ?? "",
      apiKey: env.EXOTEL_API_KEY ?? "",
      apiToken: env.EXOTEL_API_TOKEN ?? "",
      apiSubdomain: env.EXOTEL_API_SUBDOMAIN ?? "api.exotel.com",
      callerId: env.EXOTEL_CALLER_ID ?? "",
      appUrl: env.EXOTEL_APP_URL ?? "",
      agentNumber: env.EXOTEL_AGENT_NUMBER ?? "",
      statusCallbackPath: env.EXOTEL_STATUS_CALLBACK_PATH ?? "/api/voice/exotel/status",
      voicebotAppPath: env.EXOTEL_VOICEBOT_APP_PATH ?? "/api/voice/exotel/voicebot",
      voicebotStreamPath: env.EXOTEL_VOICEBOT_STREAM_PATH ?? "/api/voice/exotel/voicebot/stream",
      webhookSecret: env.EXOTEL_WEBHOOK_SECRET ?? ""
    },
    voiceAi: {
      enabled: parseBooleanEnv("VOICE_AI_ENABLED", env.VOICE_AI_ENABLED, false),
      provider:
        env.VOICE_AI_PROVIDER === "local_vosk_windows" ? "local_vosk_windows" : "openai_realtime",
      openaiApiKey: env.VOICE_AI_OPENAI_API_KEY ?? env.OPENAI_API_KEY ?? "",
      model: env.VOICE_AI_OPENAI_MODEL ?? "gpt-realtime",
      voice: env.VOICE_AI_OPENAI_VOICE ?? "alloy",
      sampleRate: Number(env.VOICE_AI_AUDIO_SAMPLE_RATE ?? 16000) === 24000 ? 24000 : 16000,
      streamToken: env.VOICE_AI_STREAM_TOKEN ?? "",
      streamTokenTtlSeconds,
      localVoskModelPath: env.VOICE_AI_LOCAL_VOSK_MODEL_PATH ?? "",
      localPythonCommand: env.VOICE_AI_LOCAL_PYTHON_COMMAND ?? "python",
      localTtsVoiceName: env.VOICE_AI_LOCAL_TTS_VOICE_NAME ?? ""
    }
  };
}

function timingSafeTextEqual(expected: string, actual: string): boolean {
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(actual);
  return (
    expectedBuffer.length === actualBuffer.length &&
    crypto.timingSafeEqual(expectedBuffer, actualBuffer)
  );
}

export function verifySharedSecret(expected: string, actual: string | undefined): boolean {
  return Boolean(expected && actual && timingSafeTextEqual(expected, actual));
}

export function createExpiringVoiceStreamToken(input: {
  secret: string;
  ttlSeconds: number;
  now?: Date;
  nonce?: string;
}): string {
  if (!input.secret) throw new Error("Voice stream signing secret is not configured");
  const expiresAt = Math.floor((input.now ?? new Date()).getTime() / 1000) + input.ttlSeconds;
  const nonce = input.nonce ?? crypto.randomBytes(18).toString("base64url");
  const payload = `${String(expiresAt)}.${nonce}`;
  const signature = crypto.createHmac("sha256", input.secret).update(payload).digest("base64url");
  return `v1.${payload}.${signature}`;
}

export function verifyExpiringVoiceStreamToken(input: {
  token: string | null | undefined;
  secret: string;
  now?: Date;
}): boolean {
  if (!input.token || !input.secret) return false;
  const [version, expiresAtText, nonce, signature, ...extra] = input.token.split(".");
  if (version !== "v1" || !expiresAtText || !nonce || !signature || extra.length > 0) return false;
  const expiresAt = Number(expiresAtText);
  if (
    !Number.isSafeInteger(expiresAt) ||
    expiresAt < Math.floor((input.now ?? new Date()).getTime() / 1000)
  ) {
    return false;
  }
  const expected = crypto
    .createHmac("sha256", input.secret)
    .update(`${expiresAtText}.${nonce}`)
    .digest("base64url");
  return timingSafeTextEqual(expected, signature);
}

export function addExotelWebhookCredential(url: string, secret: string): string {
  if (!secret) return url;
  const parsed = new URL(url);
  parsed.searchParams.set("exotel_auth", secret);
  return parsed.toString();
}

export function getCallingAutomationConfig(
  env: NodeJS.ProcessEnv = process.env
): CallingAutomationConfig {
  const attemptsSameDay = Number(env.CALLING_AUTOMATION_ATTEMPTS_SAME_DAY ?? 2);
  const sameDaySpacingMinutes = Number(env.CALLING_AUTOMATION_SAME_DAY_SPACING_MINUTES ?? 240);
  const waitDaysAfterSameDay = Number(env.CALLING_AUTOMATION_WAIT_DAYS_AFTER_SAME_DAY ?? 3);
  const maxAttempts = Number(env.CALLING_AUTOMATION_MAX_ATTEMPTS ?? 3);

  if (!Number.isInteger(attemptsSameDay) || attemptsSameDay < 1 || attemptsSameDay > 5) {
    throw new Error("CALLING_AUTOMATION_ATTEMPTS_SAME_DAY must be an integer between 1 and 5");
  }
  if (
    !Number.isInteger(sameDaySpacingMinutes) ||
    sameDaySpacingMinutes < 1 ||
    sameDaySpacingMinutes > 1440
  ) {
    throw new Error(
      "CALLING_AUTOMATION_SAME_DAY_SPACING_MINUTES must be an integer between 1 and 1440"
    );
  }
  if (
    !Number.isInteger(waitDaysAfterSameDay) ||
    waitDaysAfterSameDay < 1 ||
    waitDaysAfterSameDay > 30
  ) {
    throw new Error(
      "CALLING_AUTOMATION_WAIT_DAYS_AFTER_SAME_DAY must be an integer between 1 and 30"
    );
  }
  if (!Number.isInteger(maxAttempts) || maxAttempts < attemptsSameDay || maxAttempts > 10) {
    throw new Error(
      "CALLING_AUTOMATION_MAX_ATTEMPTS must be an integer between CALLING_AUTOMATION_ATTEMPTS_SAME_DAY and 10"
    );
  }

  return {
    enabled: parseBooleanEnv("CALLING_AUTOMATION_ENABLED", env.CALLING_AUTOMATION_ENABLED, true),
    attemptsSameDay,
    sameDaySpacingMinutes,
    waitDaysAfterSameDay,
    maxAttempts
  };
}

export function getFollowUpTimingConfig(
  env: NodeJS.ProcessEnv = process.env
): FollowUpTimingConfig {
  const mode = parseFollowUpCadenceMode(env.FOLLOW_UP_CADENCE_MODE);
  const nodeEnv = env.NODE_ENV ?? "development";
  const appEnv = env.APP_ENV ?? "";
  const productionCadenceDays = [0, 1, 5, 9];
  const offsetsMinutes =
    mode === "e2e_accelerated_minutes"
      ? parseNumberCsv(
          "FOLLOW_UP_E2E_CADENCE_MINUTES",
          env.FOLLOW_UP_E2E_CADENCE_MINUTES,
          [0, 1, 3, 5]
        )
      : productionCadenceDays.map((day) => day * 24 * 60);

  if (offsetsMinutes.length !== productionCadenceDays.length) {
    throw new Error("FOLLOW_UP_E2E_CADENCE_MINUTES must contain exactly 4 offsets");
  }

  for (let index = 1; index < offsetsMinutes.length; index += 1) {
    const current = offsetsMinutes[index];
    const previous = offsetsMinutes[index - 1];
    if (current === undefined || previous === undefined || current < previous) {
      throw new Error("FOLLOW_UP_E2E_CADENCE_MINUTES must be sorted ascending");
    }
  }

  if (mode === "e2e_accelerated_minutes" && (nodeEnv === "production" || appEnv !== "e2e-local")) {
    throw new Error(
      "FOLLOW_UP_CADENCE_MODE=e2e_accelerated_minutes is only allowed when APP_ENV=e2e-local and NODE_ENV is not production"
    );
  }

  return {
    mode,
    nodeEnv,
    appEnv,
    productionCadenceDays,
    offsetsMinutes
  };
}

export function getMessagingConfig(env: NodeJS.ProcessEnv = process.env): MessagingConfig {
  const timeoutMs = Number(env.MESSAGING_TIMEOUT_MS ?? 30000);
  const maxRetries = Number(env.MESSAGING_MAX_RETRIES ?? 1);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 120000) {
    throw new Error("MESSAGING_TIMEOUT_MS must be an integer between 1000 and 120000");
  }
  if (!Number.isInteger(maxRetries) || maxRetries < 0 || maxRetries > 5) {
    throw new Error("MESSAGING_MAX_RETRIES must be an integer between 0 and 5");
  }

  return {
    provider: parseMessagingProvider(env.MESSAGING_PROVIDER),
    nodeEnv: env.NODE_ENV ?? "development",
    webhookBaseUrl: env.MESSAGING_WEBHOOK_BASE_URL ?? env.VOICE_WEBHOOK_BASE_URL ?? "",
    templatePolicyMode: parseTemplatePolicyMode(env.WHATSAPP_TEMPLATE_POLICY_MODE),
    e2eAllowedToNumbers: parseCsv(env.WHATSAPP_E2E_ALLOWED_TO_NUMBERS),
    timeoutMs,
    maxRetries,
    metaWhatsApp: {
      graphApiBaseUrl: env.WHATSAPP_GRAPH_API_BASE_URL ?? "https://graph.facebook.com/v20.0",
      accessToken: env.WHATSAPP_ACCESS_TOKEN ?? "",
      phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID ?? "",
      businessAccountId: env.WHATSAPP_BUSINESS_ACCOUNT_ID ?? "",
      appSecret: env.WHATSAPP_APP_SECRET ?? "",
      webhookVerifyToken: env.WHATSAPP_WEBHOOK_VERIFY_TOKEN ?? env.WHATSAPP_VERIFY_TOKEN ?? "",
      defaultTemplateName: env.WHATSAPP_DEFAULT_TEMPLATE_NAME ?? "",
      defaultTemplateLanguage: env.WHATSAPP_DEFAULT_TEMPLATE_LANGUAGE ?? "en"
    },
    twilioWhatsApp: {
      accountSid: env.TWILIO_WHATSAPP_ACCOUNT_SID ?? env.TWILIO_ACCOUNT_SID ?? "",
      authToken: env.TWILIO_WHATSAPP_AUTH_TOKEN ?? env.TWILIO_AUTH_TOKEN ?? "",
      sandboxFrom: env.TWILIO_WHATSAPP_SANDBOX_FROM ?? "",
      contentSid: env.TWILIO_WHATSAPP_CONTENT_SID ?? "",
      defaultBody:
        env.TWILIO_WHATSAPP_DEFAULT_BODY ??
        "Hello from Shilabs AI Sales Engine. Reply here and our team will follow up."
    }
  };
}

export function getAuthConfig(env: NodeJS.ProcessEnv = process.env): AuthConfig {
  const jwtSecret = env.JWT_SECRET ?? "";
  const accessTokenTtlSeconds = Number(env.JWT_ACCESS_TOKEN_TTL_SECONDS ?? 3600);
  const bcryptSaltRounds = Number(env.BCRYPT_SALT_ROUNDS ?? 12);

  if (jwtSecret.length < 32) {
    throw new Error("JWT_SECRET must be at least 32 characters long");
  }

  if (!Number.isInteger(accessTokenTtlSeconds) || accessTokenTtlSeconds <= 0) {
    throw new Error("JWT_ACCESS_TOKEN_TTL_SECONDS must be a positive integer");
  }

  if (!Number.isInteger(bcryptSaltRounds) || bcryptSaltRounds < 10 || bcryptSaltRounds > 15) {
    throw new Error("BCRYPT_SALT_ROUNDS must be an integer between 10 and 15");
  }

  return {
    jwtSecret,
    accessTokenTtlSeconds,
    bcryptSaltRounds
  };
}
