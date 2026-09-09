import type { Request, Response } from "express";
import type { ContactDto } from "@shilabs/shared-types";
import type { CreateContactInput, UpdateContactInput } from "./contact.schemas.js";
import { createContact, getContact, listContacts, updateContact } from "./contact.service.js";

export async function listContactsController(
  _request: Request,
  response: Response<ContactDto[]>
): Promise<void> {
  response.status(200).json(await listContacts());
}

export async function getContactController(
  request: Request<{ id: string }>,
  response: Response<ContactDto>
): Promise<void> {
  response.status(200).json(await getContact(request.params.id));
}

export async function createContactController(
  request: Request<Record<string, never>, ContactDto, CreateContactInput>,
  response: Response<ContactDto>
): Promise<void> {
  response.status(201).json(await createContact(request.body));
}

export async function updateContactController(
  request: Request<{ id: string }, ContactDto, UpdateContactInput>,
  response: Response<ContactDto>
): Promise<void> {
  response.status(200).json(await updateContact(request.params.id, request.body));
}
