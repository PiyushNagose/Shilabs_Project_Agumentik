import type { Request, Response } from "express";
import type { MessagingHealthDto } from "./messaging.provider.js";
import {
  getMessagingHealth,
  ingestMetaWhatsAppWebhook,
  ingestTwilioWhatsAppWebhook,
  verifyMetaWebhookChallenge
} from "./messaging.service.js";

export async function getMessagingHealthController(
  _request: Request,
  response: Response<MessagingHealthDto>
): Promise<void> {
  response.status(200).json(await getMessagingHealth());
}

export function verifyMetaWhatsAppWebhookController(request: Request, response: Response): void {
  const challenge = verifyMetaWebhookChallenge({
    mode: typeof request.query["hub.mode"] === "string" ? request.query["hub.mode"] : undefined,
    token: typeof request.query["hub.verify_token"] === "string" ? request.query["hub.verify_token"] : undefined,
    challenge: typeof request.query["hub.challenge"] === "string" ? request.query["hub.challenge"] : undefined
  });
  response.status(200).send(challenge);
}

export async function ingestMetaWhatsAppWebhookController(
  request: Request,
  response: Response<{ provider: "META_WHATSAPP"; processed: number }>
): Promise<void> {
  response.status(200).json(
    await ingestMetaWhatsAppWebhook({
      body: request.body,
      rawBody: (request as Request & { rawBody?: string }).rawBody ?? JSON.stringify(request.body),
      signature: request.header("x-hub-signature-256") ?? undefined
    })
  );
}

export async function ingestTwilioWhatsAppWebhookController(
  request: Request,
  response: Response<{ provider: "TWILIO_WHATSAPP"; processed: number }>
): Promise<void> {
  response.status(200).json(
    await ingestTwilioWhatsAppWebhook({
      body: request.body as Record<string, unknown>,
      signature: request.header("x-twilio-signature") ?? undefined
    })
  );
}
