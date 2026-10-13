import { z } from "zod";

export const integrationCatalogKeySchema = z.enum([
  "zoho-bigin",
  "aws-ses",
  "mailpit",
  "google-calendar",
  "openai",
  "gemini",
  "twilio-whatsapp",
  "meta-whatsapp",
  "twilio-voice",
  "exotel-voice"
]);

export const connectIntegrationSchema = z.object({
  displayName: z.string().trim().min(1).max(120).optional()
});

export type IntegrationCatalogKey = z.infer<typeof integrationCatalogKeySchema>;
export type ConnectIntegrationInput = z.infer<typeof connectIntegrationSchema>;
