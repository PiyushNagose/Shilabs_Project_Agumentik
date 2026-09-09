import type { Request, Response } from "express";
import type { CompanyDto } from "@shilabs/shared-types";
import type { CreateCompanyInput, UpdateCompanyInput } from "./company.schemas.js";
import { createCompany, getCompany, listCompanies, updateCompany } from "./company.service.js";

export async function listCompaniesController(
  _request: Request,
  response: Response<CompanyDto[]>
): Promise<void> {
  response.status(200).json(await listCompanies());
}

export async function getCompanyController(
  request: Request<{ id: string }>,
  response: Response<CompanyDto>
): Promise<void> {
  response.status(200).json(await getCompany(request.params.id));
}

export async function createCompanyController(
  request: Request<Record<string, never>, CompanyDto, CreateCompanyInput>,
  response: Response<CompanyDto>
): Promise<void> {
  response.status(201).json(await createCompany(request.body));
}

export async function updateCompanyController(
  request: Request<{ id: string }, CompanyDto, UpdateCompanyInput>,
  response: Response<CompanyDto>
): Promise<void> {
  response.status(200).json(await updateCompany(request.params.id, request.body));
}
