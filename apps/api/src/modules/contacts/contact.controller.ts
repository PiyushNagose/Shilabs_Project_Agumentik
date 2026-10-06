import type { Request, Response } from "express";
import type { ContactDto } from "@shilabs/shared-types";
import type { CreateContactInput, UpdateContactInput } from "./contact.schemas.js";
import { createContact, getContact, listContacts, updateContact } from "./contact.service.js";
import { getRequiredUser } from "../../middleware/auth.middleware.js";

export async function listContactsController(
  request: Request,
  response: Response<ContactDto[]>
): Promise<void> {
  response.status(200).json(await listContacts(getRequiredUser(request)));
}

export async function getContactController(
  request: Request<{ id: string }>,
  response: Response<ContactDto>
): Promise<void> {
  response.status(200).json(await getContact(getRequiredUser(request), request.params.id));
}

export async function createContactController(
  request: Request<Record<string, never>, ContactDto, CreateContactInput>,
  response: Response<ContactDto>
): Promise<void> {
  response.status(201).json(await createContact(getRequiredUser(request), request.body));
}

export async function updateContactController(
  request: Request<{ id: string }, ContactDto, UpdateContactInput>,
  response: Response<ContactDto>
): Promise<void> {
  response
    .status(200)
    .json(await updateContact(getRequiredUser(request), request.params.id, request.body));
}
