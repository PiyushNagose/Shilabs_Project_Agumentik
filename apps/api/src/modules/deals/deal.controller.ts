import type { Request, Response } from "express";
import type { DealDto } from "@shilabs/shared-types";
import { AppError } from "../../shared/errors.js";
import { createDeal, getDeal, updateDeal } from "./deal.service.js";
import type { CreateDealInput, UpdateDealInput } from "./deal.schemas.js";

function requireRequestUser(request: Request) {
  if (!request.user) {
    throw new AppError(401, "AUTHENTICATION_ERROR", "Authentication required");
  }

  return request.user;
}

export async function createDealController(
  request: Request<Record<string, never>, DealDto, CreateDealInput>,
  response: Response<DealDto>
): Promise<void> {
  const deal = await createDeal(requireRequestUser(request), request.body);
  response.status(201).json(deal);
}

export async function getDealController(
  request: Request<{ id: string }>,
  response: Response<DealDto>
): Promise<void> {
  const deal = await getDeal(requireRequestUser(request), request.params.id);
  response.status(200).json(deal);
}

export async function updateDealController(
  request: Request<{ id: string }, DealDto, UpdateDealInput>,
  response: Response<DealDto>
): Promise<void> {
  const deal = await updateDeal(requireRequestUser(request), request.params.id, request.body);
  response.status(200).json(deal);
}
