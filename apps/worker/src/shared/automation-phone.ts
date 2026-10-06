function digitsOnly(value: string): string {
  return value.replace(/\D/gu, "");
}

export function normalizeAutomationPhone(
  value: string | null | undefined,
  allowedNumbers: readonly string[] = []
): string | null {
  if (!value) return null;
  const compact = value.trim().replace(/[()\s.-]/gu, "");
  if (/^\+[1-9]\d{7,14}$/u.test(compact)) return compact;

  const digits = digitsOnly(compact);
  if (!digits) return null;
  const localDigits = digits.replace(/^0/u, "");
  const configuredMatch = allowedNumbers
    .map((number) => number.trim())
    .find((number) => {
      const configuredDigits = digitsOnly(number);
      return configuredDigits.length > 0 && configuredDigits.endsWith(localDigits);
    });

  return configuredMatch && /^\+?[1-9]\d{7,14}$/u.test(compact)
    ? compact.startsWith("+")
      ? compact
      : `+${digits}`
    : configuredMatch
      ? configuredMatch.startsWith("+")
        ? configuredMatch
        : `+${digitsOnly(configuredMatch)}`
      : null;
}
