import crypto from "node:crypto";
import { createRequire } from "node:module";
import { z } from "zod";
import { getAwsSesConfig, type AwsSesConfiguredConfig } from "../../config/aws-ses.js";
import { AppError } from "../../shared/errors.js";
import { sesInboundNotificationSchema } from "./email-feedback.schemas.js";
import { MAX_INBOUND_MIME_BYTES, parseInboundMime, type InboundMimeParser } from "./email-ses-receiving.mime.js";

const require = createRequire(import.meta.url);
const envelopeSchema = z.object({
  Type: z.enum(["Notification", "SubscriptionConfirmation"]),
  TopicArn: z.string().min(1), MessageId: z.string().min(1), Message: z.string().min(1),
  Timestamp: z.string().min(1), Signature: z.string().min(1),
  SignatureVersion: z.enum(["1", "2"]), SigningCertURL: z.url(),
  Subject: z.string().optional(), SubscribeURL: z.string().optional(), Token: z.string().optional()
});
type Envelope = z.infer<typeof envelopeSchema>;

interface RawObject {
  ContentLength?: number;
  Body?: AsyncIterable<Uint8Array> & { destroy?: () => void };
}
export interface SesReceivingDependencies {
  verify?: (envelope: Envelope) => Promise<void>;
  readObject?: (input: { bucket: string; key: string; config: AwsSesConfiguredConfig }) => Promise<RawObject>;
  parseMime?: InboundMimeParser;
  ingest?: (input: { body: unknown; rawBody: string; headers: { timestamp: string; signature: string };
    env: NodeJS.ProcessEnv }) => Promise<unknown>;
}

async function verifySns(envelope: Envelope): Promise<void> {
  const Validator = require("sns-validator") as new () => {
    validate: (message: Envelope, callback: (error: Error | null) => void) => void;
  };
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("SNS verification timed out")), 10000);
    new Validator().validate(envelope, (error) => {
      clearTimeout(timer);
      if (error) reject(error);
      else resolve();
    });
  });
}

async function readS3(input: { bucket: string; key: string; config: AwsSesConfiguredConfig }): Promise<RawObject> {
  const sdk = require("@aws-sdk/client-s3") as {
    S3Client: new (options: object) => { send: (command: unknown, options: object) => Promise<RawObject> };
    GetObjectCommand: new (options: object) => unknown;
  };
  const client = new sdk.S3Client({
    region: input.config.region, maxAttempts: input.config.maxRetries + 1,
    credentials: input.config.useDefaultCredentialChain ? undefined : {
      accessKeyId: input.config.accessKeyId ?? "", secretAccessKey: input.config.secretAccessKey ?? ""
    }
  });
  return client.send(new sdk.GetObjectCommand({ Bucket: input.bucket, Key: input.key }), {
    abortSignal: AbortSignal.timeout(input.config.timeoutMs)
  });
}

function json(value: string): unknown {
  try { return JSON.parse(value); }
  catch { throw new AppError(400, "VALIDATION_ERROR", "Invalid SES/SNS JSON"); }
}

function receivingConfig(env: NodeJS.ProcessEnv) {
  const config = getAwsSesConfig(env);
  const topic = env.AWS_SES_INBOUND_TOPIC_ARN?.trim();
  const bucket = env.AWS_SES_INBOUND_BUCKET?.trim();
  const configuredPrefix = env.AWS_SES_INBOUND_KEY_PREFIX?.trim();
  const prefix = configuredPrefix?.length ? configuredPrefix : "inbound/";
  const arn = /^arn:(aws|aws-cn|aws-us-gov):sns:([a-z0-9-]+):\d{12}:[A-Za-z0-9_-]+$/.exec(topic ?? "");
  if (config.status !== "CONFIGURED" || !topic || !bucket || arn?.[2] !== config.region ||
      !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket) ||
      !prefix.endsWith("/") || hasInvalidS3Characters(prefix) ||
      prefix.split("/").some((segment) => segment === ".." || segment === ".")) {
    throw new AppError(503, "PROVIDER_ERROR", "SES receiving requires configured SES, AWS_SES_INBOUND_TOPIC_ARN and AWS_SES_INBOUND_BUCKET");
  }
  return { config, topic, bucket, prefix, partition: arn[1] };
}

function hasInvalidS3Characters(value: string): boolean {
  return Array.from(value).some((character) => character.charCodeAt(0) <= 31 || character === "\\");
}

function allowedS3Location(value: unknown, settings: ReturnType<typeof receivingConfig>) {
  const action = z.object({ type: z.literal("S3").optional(), bucketName: z.string(), objectKey: z.string().min(1) })
    .safeParse(value);
  if (!action.success || action.data.bucketName !== settings.bucket || !action.data.objectKey.startsWith(settings.prefix) ||
      action.data.objectKey.length <= settings.prefix.length || Buffer.byteLength(action.data.objectKey) > 1024 || hasInvalidS3Characters(action.data.objectKey) ||
      action.data.objectKey.split("/").some((segment) => segment === ".." || segment === ".")) {
    throw new AppError(403, "AUTHORIZATION_ERROR", "SES S3 location is not allowed");
  }
  return { bucket: settings.bucket, key: action.data.objectKey, config: settings.config };
}

async function readBoundedS3(
  input: Parameters<typeof readS3>[0],
  readObject: NonNullable<SesReceivingDependencies["readObject"]> = readS3
): Promise<Buffer> {
  let object: RawObject | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = { expired: false };
  try {
    return await Promise.race([
      (async () => {
        object = await readObject(input);
        if (deadline.expired) {
          object.Body?.destroy?.();
          throw new AppError(504, "PROVIDER_ERROR", "SES raw email retrieval timed out");
        }
        if (!object.Body) throw new AppError(404, "NOT_FOUND", "Stored SES raw email is unavailable");
        if (object.ContentLength !== undefined && object.ContentLength > MAX_INBOUND_MIME_BYTES) {
          throw new AppError(413, "VALIDATION_ERROR", "SES raw email exceeds byte limit");
        }
        const chunks: Buffer[] = [];
        let bytes = 0;
        for await (const chunk of object.Body) {
          bytes += chunk.byteLength;
          if (bytes > MAX_INBOUND_MIME_BYTES) throw new AppError(413, "VALIDATION_ERROR", "SES raw email exceeds byte limit");
          chunks.push(Buffer.from(chunk));
        }
        if (!bytes) throw new AppError(404, "NOT_FOUND", "Stored SES raw email is empty");
        return Buffer.concat(chunks);
      })(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          deadline.expired = true;
          reject(new AppError(504, "PROVIDER_ERROR", "SES raw email retrieval timed out"));
          object?.Body?.destroy?.();
        }, input.config.timeoutMs);
      })
    ]);
  } catch (error) {
    if (error && typeof error === "object" && (
      ("name" in error && ["NoSuchKey", "NotFound"].includes(String(error.name))) ||
      ("$metadata" in error && error.$metadata && typeof error.$metadata === "object" &&
        "httpStatusCode" in error.$metadata && error.$metadata.httpStatusCode === 404)
    )) throw new AppError(404, "NOT_FOUND", "Stored SES raw email is unavailable");
    throw error;
  } finally { clearTimeout(timer); object?.Body?.destroy?.(); }
}

// Callers must authorize access to the parent message before supplying its persisted payload.
export async function downloadStoredSesAttachment(
  rawProviderPayload: unknown,
  index: number,
  env: NodeJS.ProcessEnv = process.env,
  dependencies: Pick<SesReceivingDependencies, "readObject" | "parseMime"> = {}
): Promise<{ bytes: Buffer; fileName: string; contentType: string }> {
  if (!Number.isSafeInteger(index) || index < 0 || index >= 100) {
    throw new AppError(404, "NOT_FOUND", "Stored SES attachment is unavailable");
  }
  const settings = receivingConfig(env);
  const stored = z.object({ receipt: z.object({ action: z.object({
    bucketName: z.string(), objectKey: z.string(), type: z.string().optional()
  }) }) }).safeParse(rawProviderPayload);
  if (!stored.success) {
    throw new AppError(404, "NOT_FOUND", "Stored SES raw email reference is unavailable");
  }
  const location = allowedS3Location(stored.data.receipt.action, settings);
  const raw = await readBoundedS3(location, dependencies.readObject);
  const mime = await parseInboundMime(raw, dependencies.parseMime);
  const attachment = mime.attachments[index];
  const bytes = mime.attachmentContents[index];
  if (!attachment || !Buffer.isBuffer(bytes)) {
    throw new AppError(404, "NOT_FOUND", "Stored SES attachment is unavailable");
  }
  if (bytes.byteLength > MAX_INBOUND_MIME_BYTES) {
    throw new AppError(413, "VALIDATION_ERROR", "SES attachment exceeds byte limit");
  }
  return { bytes, fileName: attachment.fileName, contentType: attachment.contentType };
}

export async function receiveSesSns(
  body: unknown,
  env: NodeJS.ProcessEnv = process.env,
  dependencies: SesReceivingDependencies = {}
): Promise<unknown> {
  const settings = receivingConfig(env);
  const { config, topic } = settings;
  const parsed = envelopeSchema.safeParse(typeof body === "string" ? json(body) : body);
  if (!parsed.success) throw new AppError(400, "VALIDATION_ERROR", "Invalid SNS envelope");
  const envelope = parsed.data;
  if (envelope.TopicArn !== topic) throw new AppError(403, "AUTHORIZATION_ERROR", "SNS topic is not allowed");
  const cert = new URL(envelope.SigningCertURL);
  const domain = `sns.${config.region}.amazonaws.com${settings.partition === "aws-cn" ? ".cn" : ""}`;
  if (cert.protocol !== "https:" || cert.hostname !== domain || cert.port || cert.username ||
      cert.password || cert.search || cert.hash || !/^\/SimpleNotificationService-[A-Za-z0-9_-]+\.pem$/.test(cert.pathname)) {
    throw new AppError(403, "AUTHORIZATION_ERROR", "SNS certificate URL is not allowed");
  }
  try { await (dependencies.verify ?? verifySns)(envelope); }
  catch { throw new AppError(403, "AUTHORIZATION_ERROR", "SNS signature verification failed"); }
  if (envelope.Type === "SubscriptionConfirmation") {
    if (!envelope.Token || !envelope.SubscribeURL) throw new AppError(400, "VALIDATION_ERROR", "Invalid SNS confirmation");
    return { status: "PENDING_MANUAL_CONFIRMATION", topicArn: topic, receivingEnabled: false };
  }
  const notification = sesInboundNotificationSchema.safeParse(json(envelope.Message));
  if (!notification.success) throw new AppError(400, "VALIDATION_ERROR", "Invalid SES receipt");
  if (!z.object({ type: z.literal("S3") }).safeParse(notification.data.receipt?.action).success) {
    throw new AppError(403, "AUTHORIZATION_ERROR", "SES S3 location is not allowed");
  }
  const location = allowedS3Location(notification.data.receipt?.action, settings);
  const raw = await readBoundedS3(location, dependencies.readObject);
  const mime = await parseInboundMime(raw, dependencies.parseMime);
  const payload = { ...notification.data, content: undefined,
    textBody: mime.textBody, htmlBody: mime.htmlBody, attachments: mime.attachments,
    mail: { ...notification.data.mail, commonHeaders: mime.commonHeaders,
      headers: Array.from(mime.headers, ([name, value]) => ({ name, value })) }
  };
  const wrapped = { MessageId: envelope.MessageId, Message: JSON.stringify(payload) };
  const rawBody = JSON.stringify(wrapped);
  const timestamp = String(Date.now());
  const signature = `sha256=${crypto.createHmac("sha256", config.webhookSecret).update(`${timestamp}.${rawBody}`).digest("hex")}`;
  const ingest = dependencies.ingest ?? (await import("./email.service.js")).ingestSesInboundEmail;
  return ingest({ body: wrapped, rawBody, headers: { timestamp, signature }, env });
}
