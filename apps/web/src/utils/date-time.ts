export function formatDateTime(value: string | null | undefined, empty = "Not scheduled"): string {
  if (!value) return empty;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Time unavailable";
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short"
  }).format(date);
}

export interface ExecutionTimes {
  status: string;
  nextRunAt?: string | null;
  startedAt: string | null;
  actualStartedAt?: string | null;
  completedAt: string | null;
  createdAt?: string;
}

export function executionTiming(
  run: ExecutionTimes,
  now = Date.now()
): {
  label: string;
  at: string | null;
  detail: string;
} {
  if (run.status === "QUEUED" || run.status === "WAITING") {
    return run.nextRunAt
      ? {
          label: run.status === "WAITING" ? "Resumes at" : "Scheduled for",
          at: run.nextRunAt,
          detail:
            new Date(run.nextRunAt).getTime() < now
              ? "Past scheduled time; awaiting execution"
              : "Awaiting execution"
        }
      : { label: "Waiting to start", at: null, detail: "Execution time has not been scheduled" };
  }
  if (run.status === "HUMAN_REQUIRED")
    return { label: "Needs your response", at: null, detail: "Paused until a person takes action" };
  if (["SUCCEEDED", "FAILED", "CANCELED"].includes(run.status))
    return {
      label:
        run.status === "SUCCEEDED"
          ? "Completed at"
          : run.status === "FAILED"
            ? "Failed at"
            : "Canceled at",
      at: run.completedAt,
      detail: run.completedAt ? "" : "Finish time not recorded"
    };
  const start = run.actualStartedAt !== undefined ? run.actualStartedAt : run.startedAt;
  return {
    label: "Started at",
    at: start,
    detail: start ? "In progress" : "Start time not recorded"
  };
}

export function executionStatusLabel(status: string, scheduled = false): string {
  if (status === "QUEUED") return scheduled ? "Scheduled" : "Queued";
  if (status === "WAITING") return "Waiting";
  if (status === "HUMAN_REQUIRED") return "Needs your response";
  if (status === "SUCCEEDED") return "Completed";
  if (status === "FAILED") return "Failed";
  if (status === "CANCELED") return "Canceled";
  return "In progress";
}
