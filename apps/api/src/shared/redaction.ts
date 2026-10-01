const SECRET_KEY_PATTERN = /(secret|token|password|credential|authorization|api[_-]?key|refresh[_-]?token)/iu;
const SECRET_VALUE_PATTERNS = [
  /sk-[A-Za-z0-9_-]{12,}/gu,
  /ya29\.[A-Za-z0-9_-]+/gu,
  /Bearer\s+[A-Za-z0-9._-]+/giu,
  /Basic\s+[A-Za-z0-9+/=]+/giu
];

function redactString(value: string): string {
  return SECRET_VALUE_PATTERNS.reduce(
    (current, pattern) => current.replace(pattern, "[REDACTED]"),
    value
  );
}

function redactUnknown(value: unknown): unknown {
  if (typeof value === "string") {
    return redactString(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactUnknown(item));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
        key,
        SECRET_KEY_PATTERN.test(key) ? "[REDACTED]" : redactUnknown(entry)
      ])
    );
  }
  return value;
}

export function redactSecrets(value: string): string;
export function redactSecrets<T>(value: T): T;
export function redactSecrets(value: unknown): unknown {
  return redactUnknown(value);
}
