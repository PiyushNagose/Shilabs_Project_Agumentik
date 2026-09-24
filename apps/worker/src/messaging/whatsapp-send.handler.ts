import type { DomainEventHandlerMap } from "../domain-events/domain-event.processor.js";
import { executeWhatsAppSend } from "./whatsapp-send.service.js";

export const whatsAppDomainEventHandlers: DomainEventHandlerMap = {
  WHATSAPP_SEND_REQUESTED: {
    handle: (event) => executeWhatsAppSend({ event })
  }
};
