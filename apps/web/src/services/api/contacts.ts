import type { ContactDto } from "@shilabs/shared-types";
import { apiRequest } from "./core.js";

export interface ContactBody {
  companyId: string;
  firstName: string;
  lastName: string;
  title?: string | null;
  email?: string | null;
  phone?: string | null;
  whatsappId?: string | null;
  source?: string | null;
  preferredChannel?: string | null;
  doNotContact?: boolean;
}

export function listContacts(accessToken: string): Promise<ContactDto[]> {
  return apiRequest<ContactDto[]>("/api/contacts", accessToken);
}

export function createContact(accessToken: string, body: ContactBody): Promise<ContactDto> {
  return apiRequest<ContactDto>("/api/contacts", accessToken, {
    method: "POST",
    body: JSON.stringify(body)
  });
}
