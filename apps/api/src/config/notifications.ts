export function getNotificationConfig(env: NodeJS.ProcessEnv = process.env): {
  enabled: boolean;
  maxAttempts: number;
} {
  const attempts = Number(env.NOTIFICATION_ESCALATION_MAX_ATTEMPTS ?? 5);
  return {
    enabled: env.NOTIFICATION_ESCALATION_ENABLED === "true",
    maxAttempts: Number.isInteger(attempts) && attempts >= 2 && attempts <= 10 ? attempts : 5
  };
}
