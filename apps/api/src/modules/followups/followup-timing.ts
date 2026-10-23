export function getFollowUpDays(
  policyDays: number[],
  mode = "STANDARD",
  customDays: number[] = []
): number[] {
  const days = [...new Set(policyDays.filter((day) => day > 0))].sort((a, b) => a - b);
  if (mode === "CUSTOM")
    return [...new Set(customDays.filter((day) => day > 0))].sort((a, b) => a - b);
  const interval =
    mode === "AGGRESSIVE" ? 1 : mode === "LOW_FREQUENCY" ? 7 : mode === "HIGH_VALUE" ? 2 : null;
  return interval === null ? days : days.map((_, index) => interval * (index + 1));
}

export function followUpReadyAt(input: {
  sequenceCreatedAt: Date;
  scheduledAt: Date;
  stepIndex: number;
  cadenceDays: number[];
  cadenceMode: string;
  nextActionAt?: Date | null;
}): Date {
  const day = input.cadenceDays[input.stepIndex] ?? 0;
  const policyTime =
    input.cadenceMode === "E2E_ACCELERATED_MINUTES"
      ? input.scheduledAt.getTime()
      : input.sequenceCreatedAt.getTime() + day * 86_400_000;
  return new Date(
    Math.max(input.scheduledAt.getTime(), policyTime, input.nextActionAt?.getTime() ?? 0)
  );
}
