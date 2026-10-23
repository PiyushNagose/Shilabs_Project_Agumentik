import { executionTiming, formatDateTime, type ExecutionTimes } from "../utils/date-time.js";

export function ExecutionTiming({ run }: { run: ExecutionTimes }): React.JSX.Element {
  const timing = executionTiming(run);
  return (
    <span className="execution-timing" data-label="Timing">
      <strong>{timing.label}</strong>
      {timing.at ? <time dateTime={timing.at}>{formatDateTime(timing.at)}</time> : null}
      {timing.detail ? <small>{timing.detail}</small> : null}
    </span>
  );
}
