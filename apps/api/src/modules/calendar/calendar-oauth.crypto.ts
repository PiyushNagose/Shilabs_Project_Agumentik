import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { AppError } from "../../shared/errors.js";

export function calendarEncryptionKey(env: NodeJS.ProcessEnv): Buffer {
  const value = env.CALENDAR_OAUTH_ENCRYPTION_KEY ?? "";
  if (!/^[a-fA-F0-9]{64}$/.test(value)) {
    throw new AppError(503, "PROVIDER_ERROR", "Calendar OAuth requires a 32-byte hex encryption key");
  }
  return Buffer.from(value, "hex");
}

export function encryptCalendarSecret(value: string, context: string, env: NodeJS.ProcessEnv): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", calendarEncryptionKey(env), iv);
  cipher.setAAD(Buffer.from(context));
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(".");
}

export function decryptCalendarSecret(value: string, context: string, env: NodeJS.ProcessEnv): string {
  const key = calendarEncryptionKey(env);
  try {
    const [version, iv, tag, encrypted, extra] = value.split(".");
    if (version !== "v1" || !iv || !tag || !encrypted || extra !== undefined) throw new Error();
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
    decipher.setAAD(Buffer.from(context));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(encrypted, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    throw new AppError(503, "PROVIDER_ERROR", "Saved calendar credentials cannot be decrypted; reconnect Google Calendar");
  }
}
