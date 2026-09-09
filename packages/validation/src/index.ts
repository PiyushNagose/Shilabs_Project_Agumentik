export interface ValidationResult<TValue> {
  success: boolean;
  value?: TValue;
  errors?: string[];
}

export function normalizeEmail(value: string | null | undefined): string | null {
  const trimmed = value?.trim().toLowerCase();
  if (!trimmed) {
    return null;
  }

  return trimmed;
}

export function normalizePhone(value: string | null | undefined): string | null {
  const digits = value?.replace(/\D/g, "") ?? "";
  return digits ? digits : null;
}

export function normalizeWebsite(value: string | null | undefined): string | null {
  const trimmed = value?.trim().toLowerCase();
  if (!trimmed) {
    return null;
  }

  const withProtocol = /^https?:\/\//u.test(trimmed) ? trimmed : `https://${trimmed}`;

  try {
    const url = new URL(withProtocol);
    return url.hostname.replace(/^www\./u, "");
  } catch {
    return (
      trimmed
        .replace(/^https?:\/\//u, "")
        .replace(/^www\./u, "")
        .split("/")[0] ?? trimmed
    );
  }
}
