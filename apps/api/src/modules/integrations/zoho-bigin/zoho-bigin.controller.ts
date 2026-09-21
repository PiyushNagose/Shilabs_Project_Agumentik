import type { Request, Response } from "express";
import type { IntegrationHealthDto } from "@shilabs/shared-types";
import { getZohoBiginHealth } from "./zoho-bigin.service.js";

export async function getZohoBiginHealthController(
  _request: Request,
  response: Response<IntegrationHealthDto>
): Promise<void> {
  response.status(200).json(await getZohoBiginHealth());
}
