import type { DomainEventHandlerMap } from "../domain-events/domain-event.processor.js";
import { workerPrisma } from "../domain-events/domain-event.repository.js";
import { NotificationDeliveryService } from "./notification-delivery.service.js";

export const notificationDomainEventHandlers: DomainEventHandlerMap = {
  NOTIFICATION_ESCALATED: {
    handle: (event) => new NotificationDeliveryService(workerPrisma).deliver(event)
  }
};
