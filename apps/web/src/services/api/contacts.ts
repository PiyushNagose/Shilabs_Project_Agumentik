import type { ContactDto } from "@shilabs/shared-types";
import { apiRequest } from "./core.js";

export function listContacts(accessToken: string): Promise<ContactDto[]> {
  return apiRequest<ContactDto[]>("/api/contacts", accessToken);
}
