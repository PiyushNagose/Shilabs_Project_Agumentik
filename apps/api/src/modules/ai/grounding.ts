function normalizeGroundingText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function sourceContainsGroundedQuote(sourceText: string | undefined, quote: string): boolean {
  if (!sourceText) return false;
  if (sourceText.includes(quote)) return true;
  const normalizedSource = normalizeGroundingText(sourceText);
  const normalizedQuote = normalizeGroundingText(quote);
  return normalizedQuote.length > 0 && normalizedSource.includes(normalizedQuote);
}
