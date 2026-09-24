import { z } from "zod";

export const manualVoiceCallSchema = z.object({
  leadId: z.string().min(1).max(64),
  idempotencyKey: z.string().trim().min(8).max(200),
  regionalVoice: z.string().trim().min(1).max(80).optional(),
  accent: z.string().trim().min(1).max(80).optional()
});

export type ManualVoiceCallInput = z.infer<typeof manualVoiceCallSchema>;

export const twilioStatusWebhookSchema = z.object({
  CallSid: z.string().trim().min(1).max(120),
  CallStatus: z.string().trim().min(1).max(80),
  CallDuration: z.string().trim().max(20).optional(),
  SequenceNumber: z.string().trim().max(20).optional(),
  Timestamp: z.string().trim().max(120).optional()
});

export const twilioRecordingWebhookSchema = z.object({
  CallSid: z.string().trim().min(1).max(120),
  RecordingSid: z.string().trim().min(1).max(120),
  RecordingStatus: z.string().trim().min(1).max(80),
  RecordingUrl: z.string().trim().max(2000).optional(),
  RecordingDuration: z.string().trim().max(20).optional()
});

export type TwilioStatusWebhookInput = z.infer<typeof twilioStatusWebhookSchema>;
export type TwilioRecordingWebhookInput = z.infer<typeof twilioRecordingWebhookSchema>;
