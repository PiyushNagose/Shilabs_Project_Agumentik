import { z } from "zod";

const sesMailSchema = z.object({
  messageId: z.string().min(1),
  destination: z.array(z.string()).default([]),
  timestamp: z.string().optional(),
  source: z.string().optional(),
  commonHeaders: z
    .looseObject({
      from: z.array(z.string()).optional(),
      to: z.array(z.string()).optional(),
      subject: z.string().optional(),
      messageId: z.string().optional(),
      date: z.string().optional()
    })
    .optional(),
  headers: z
    .array(
      z.object({
        name: z.string(),
        value: z.string()
      })
    )
    .optional()
});

export const sesNotificationSchema = z.discriminatedUnion("notificationType", [
  z.object({
    notificationType: z.literal("Delivery"),
    mail: sesMailSchema,
    delivery: z.looseObject({})
  }),
  z.object({
    notificationType: z.literal("Bounce"),
    mail: sesMailSchema,
    bounce: z.object({
      bounceType: z.string().optional(),
      bouncedRecipients: z
        .array(
          z.object({
            emailAddress: z.string().optional()
          })
        )
        .default([])
    })
  }),
  z.object({
    notificationType: z.literal("Complaint"),
    mail: sesMailSchema,
    complaint: z.object({
      complainedRecipients: z
        .array(
          z.object({
            emailAddress: z.string().optional()
          })
        )
        .default([])
    })
  })
]);

export const snsWrappedSesNotificationSchema = z.object({
  Type: z.string().optional(),
  MessageId: z.string().min(1).optional(),
  Message: z.string().min(1)
});

export type SesNotification = z.infer<typeof sesNotificationSchema>;

export const sesInboundNotificationSchema = z.object({
  notificationType: z.literal("Received"),
  mail: sesMailSchema,
  receipt: z.record(z.string(), z.unknown()).optional(),
  content: z.string().optional(),
  textBody: z.string().optional(),
  htmlBody: z.string().optional()
});

export type SesInboundNotification = z.infer<typeof sesInboundNotificationSchema>;
