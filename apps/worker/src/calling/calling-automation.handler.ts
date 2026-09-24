import type { DomainEventHandlerMap } from "../domain-events/domain-event.processor.js";
import { executeCallingAutomationAttempt } from "./calling-automation.service.js";

export const callingDomainEventHandlers: DomainEventHandlerMap = {
  CALL_AUTOMATION_ATTEMPT_DUE: {
    handle: (event) => executeCallingAutomationAttempt({ event })
  }
};
