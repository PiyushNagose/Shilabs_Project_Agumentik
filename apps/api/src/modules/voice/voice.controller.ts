import type { Request, Response } from "express";
import { getVoiceConfig } from "@shilabs/shared-config";
import type {
  IntegrationHealthDto,
  VoiceCallAttemptDto,
  VoiceWebhookResultDto
} from "@shilabs/shared-types";
import { getRequiredUser } from "../../middleware/auth.middleware.js";
import {
  buildTwilioTestCallTwiml,
  createManualVoiceCall,
  getVoiceHealth,
  ingestExotelStatusWebhook,
  ingestTwilioRecordingWebhook,
  ingestTwilioStatusWebhook
} from "./voice.service.js";
import { buildExotelVoicebotStreamUrl } from "./voice-ai.service.js";
import type {
  ExotelStatusWebhookInput,
  ManualVoiceCallInput,
  TwilioRecordingWebhookInput,
  TwilioStatusWebhookInput
} from "./voice.schemas.js";

export async function getVoiceHealthController(
  _request: Request,
  response: Response<IntegrationHealthDto>
): Promise<void> {
  response.status(200).json(await getVoiceHealth());
}

export async function createManualVoiceCallController(
  request: Request<never, VoiceCallAttemptDto, ManualVoiceCallInput>,
  response: Response<VoiceCallAttemptDto>
): Promise<void> {
  response.status(201).json(await createManualVoiceCall(getRequiredUser(request), request.body));
}

export async function ingestTwilioStatusWebhookController(
  request: Request<never, VoiceWebhookResultDto, TwilioStatusWebhookInput>,
  response: Response<VoiceWebhookResultDto>
): Promise<void> {
  response.status(200).json(
    await ingestTwilioStatusWebhook({
      body: request.body,
      signature: request.header("x-twilio-signature") ?? undefined
    })
  );
}

export async function ingestTwilioRecordingWebhookController(
  request: Request<never, VoiceWebhookResultDto, TwilioRecordingWebhookInput>,
  response: Response<VoiceWebhookResultDto>
): Promise<void> {
  response.status(200).json(
    await ingestTwilioRecordingWebhook({
      body: request.body,
      signature: request.header("x-twilio-signature") ?? undefined
    })
  );
}

export async function ingestExotelStatusWebhookController(
  request: Request<never, VoiceWebhookResultDto, ExotelStatusWebhookInput>,
  response: Response<VoiceWebhookResultDto>
): Promise<void> {
  response.status(200).json(await ingestExotelStatusWebhook({ body: request.body }));
}

export function getExotelVoicebotStreamUrlController(
  request: Request,
  response: Response<{ url: string }>
): void {
  response.status(200).json(
    buildExotelVoicebotStreamUrl({
      query: { ...request.query, ...(request.body as Record<string, unknown> | undefined) }
    })
  );
}

export function getTwilioTestCallTwimlController(_request: Request, response: Response): void {
  const config = getVoiceConfig();
  if (config.nodeEnv === "production" && config.complianceConsentMode !== "confirmed") {
    response.status(404).json({
      error: {
        code: "NOT_FOUND",
        message: "Route not found"
      }
    });
    return;
  }

  response.type("text/xml").status(200).send(buildTwilioTestCallTwiml());
}
