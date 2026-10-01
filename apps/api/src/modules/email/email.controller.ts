import type { Request, Response } from "express";
import type { ParamsDictionary } from "express-serve-static-core";
import type {
  EmailDeliverabilityScanDto,
  EmailPreSendValidationDto,
  EmailSuppressionDto,
  IntegrationHealthDto,
  OutboundEmailDto,
  SesFeedbackEventDto,
  SesInboundEmailDto
} from "@shilabs/shared-types";
import { getRequiredUser } from "../../middleware/auth.middleware.js";
import {
  getAwsSesHealth,
  createEmailSuppression,
  ingestE2ECustomerReply,
  ingestSesFeedbackEvent,
  ingestSesInboundEmail,
  listEmailSuppressions,
  runEmailDeliverabilityScan,
  validateOutboundEmailPreSend,
  sendOutboundEmail
} from "./email.service.js";
import type {
  CreateEmailSuppressionInput,
  E2ECustomerReplyInput,
  SendEmailInput,
  ValidatePreSendEmailInput
} from "./email.schemas.js";

export async function sendOutboundEmailController(
  request: Request<ParamsDictionary, OutboundEmailDto, SendEmailInput>,
  response: Response<OutboundEmailDto>
): Promise<void> {
  response.status(200).json(await sendOutboundEmail(getRequiredUser(request), request.body));
}

export async function getAwsSesHealthController(
  _request: Request,
  response: Response<IntegrationHealthDto>
): Promise<void> {
  response.status(200).json(await getAwsSesHealth());
}

export async function validateOutboundEmailPreSendController(
  request: Request<ParamsDictionary, EmailPreSendValidationDto, ValidatePreSendEmailInput>,
  response: Response<EmailPreSendValidationDto>
): Promise<void> {
  response
    .status(200)
    .json(await validateOutboundEmailPreSend(getRequiredUser(request), request.body));
}

export async function listEmailSuppressionsController(
  request: Request,
  response: Response<EmailSuppressionDto[]>
): Promise<void> {
  response.status(200).json(await listEmailSuppressions(getRequiredUser(request)));
}

export async function createEmailSuppressionController(
  request: Request<ParamsDictionary, EmailSuppressionDto, CreateEmailSuppressionInput>,
  response: Response<EmailSuppressionDto>
): Promise<void> {
  response.status(200).json(await createEmailSuppression(getRequiredUser(request), request.body));
}

export async function runEmailDeliverabilityScanController(
  request: Request,
  response: Response<EmailDeliverabilityScanDto>
): Promise<void> {
  response.status(200).json(await runEmailDeliverabilityScan(getRequiredUser(request)));
}

export async function ingestSesFeedbackEventController(
  request: Request,
  response: Response<SesFeedbackEventDto>
): Promise<void> {
  const rawBody = (request as Request & { rawBody?: string }).rawBody ?? JSON.stringify(request.body);
  response.status(200).json(
    await ingestSesFeedbackEvent({
      body: request.body,
      rawBody,
      headers: {
        signature: request.header("x-shilabs-webhook-signature") ?? undefined,
        timestamp: request.header("x-shilabs-webhook-timestamp") ?? undefined
      }
    })
  );
}

export async function ingestSesInboundEmailController(
  request: Request,
  response: Response<SesInboundEmailDto>
): Promise<void> {
  const rawBody = (request as Request & { rawBody?: string }).rawBody ?? JSON.stringify(request.body);
  response.status(200).json(
    await ingestSesInboundEmail({
      body: request.body,
      rawBody,
      headers: {
        signature: request.header("x-shilabs-webhook-signature") ?? undefined,
        timestamp: request.header("x-shilabs-webhook-timestamp") ?? undefined
      }
    })
  );
}

export async function ingestE2ECustomerReplyController(
  request: Request<ParamsDictionary, SesInboundEmailDto, E2ECustomerReplyInput>,
  response: Response<SesInboundEmailDto>
): Promise<void> {
  response.status(200).json(await ingestE2ECustomerReply(getRequiredUser(request), request.body));
}
