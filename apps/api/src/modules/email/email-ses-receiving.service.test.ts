import crypto from "node:crypto";
import { Readable } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { downloadStoredSesAttachment, receiveSesSns } from "./email-ses-receiving.service.js";
import { MAX_INBOUND_MIME_BYTES, type ParsedInboundMime } from "./email-ses-receiving.mime.js";

const env = {
  AWS_SES_REGION: "us-east-1", AWS_SES_FROM_EMAIL: "sales@example.com",
  AWS_SES_USE_DEFAULT_CREDENTIAL_CHAIN: "true", AWS_SES_WEBHOOK_SECRET: "internal-secret",
  AWS_SES_INBOUND_TOPIC_ARN: "arn:aws:sns:us-east-1:123456789012:inbound",
  AWS_SES_INBOUND_BUCKET: "ses-inbound-bucket"
};
const receipt = () => ({
  notificationType: "Received", mail: { messageId: "ses-123", source: "sender@example.net", destination: ["sales@example.com"] },
  receipt: { action: { type: "S3", bucketName: env.AWS_SES_INBOUND_BUCKET, objectKey: "inbound/ses-123" } },
  textBody: "untrusted inline body"
});
const envelope = () => ({
  Type: "Notification", MessageId: "sns-123", Message: JSON.stringify(receipt()),
  TopicArn: env.AWS_SES_INBOUND_TOPIC_ARN, Timestamp: new Date().toISOString(),
  Signature: "signature", SignatureVersion: "2",
  SigningCertURL: "https://sns.us-east-1.amazonaws.com/SimpleNotificationService-test.pem"
});
const mime: ParsedInboundMime = {
  text: "Decoded customer reply", html: "<p>Decoded customer reply</p>", subject: "Decoded subject",
  from: { value: [{ address: "sender@example.net" }] },
  to: { value: [{ address: "sales@example.com" }] },
  headerLines: [
    { key: "in-reply-to", line: "In-Reply-To: <outbound-1>" },
    { key: "references", line: "References: <old-1>\r\n <outbound-1>" }
  ],
  attachments: [{ filename: "quote.pdf", contentType: "application/pdf", size: 3 }]
};
const verify = vi.fn(() => Promise.resolve());
const readObject = vi.fn(() => Promise.resolve({ Body: Readable.from([Buffer.from("raw MIME bytes")]) }));
const parseMime = vi.fn(() => Promise.resolve(mime));
const ingest = vi.fn<(input: { body: unknown; rawBody: string; headers: { timestamp: string; signature: string }; env: NodeJS.ProcessEnv }) => Promise<{ status: string }>>()
  .mockResolvedValue({ status: "PROCESSED" });
const dependencies = { verify, readObject, parseMime, ingest };

describe("SES receiving bridge (no providers or database)", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("verifies SNS before S3 and signs decoded MIME for the existing ingestion core", async () => {
    expect(await receiveSesSns(JSON.stringify(envelope()), env, dependencies)).toEqual({ status: "PROCESSED" });
    const readOrder = readObject.mock.invocationCallOrder[0];
    if (readOrder === undefined) throw new Error("Expected S3 to be read");
    expect(verify.mock.invocationCallOrder[0]).toBeLessThan(readOrder);
    expect(readObject).toHaveBeenCalledWith(expect.objectContaining({ bucket: env.AWS_SES_INBOUND_BUCKET, key: "inbound/ses-123" }));
    expect(parseMime).toHaveBeenCalledWith(Buffer.from("raw MIME bytes"));
    const input = ingest.mock.calls[0]?.[0];
    if (!input) throw new Error("Expected ingestion to be called");
    const expected = crypto.createHmac("sha256", env.AWS_SES_WEBHOOK_SECRET)
      .update(`${input.headers.timestamp}.${input.rawBody}`).digest("hex");
    expect(input.headers.signature).toBe(`sha256=${expected}`);
    const wrapped = z.object({ MessageId: z.string(), Message: z.string() }).parse(JSON.parse(input.rawBody));
    const payload: unknown = JSON.parse(wrapped.Message);
    expect(wrapped.MessageId).toBe("sns-123");
    expect(payload).toMatchObject({ textBody: mime.text, htmlBody: mime.html,
      mail: { messageId: "ses-123", commonHeaders: { subject: mime.subject, from: ["sender@example.net"] } },
      attachments: [{ fileName: "quote.pdf", sizeBytes: 3 }] });
    expect(payload).not.toHaveProperty("content");
    expect(payload).toHaveProperty("mail.headers", expect.arrayContaining([
      { name: "in-reply-to", value: "<outbound-1>" }
    ]));
  });

  it.each(["AWS_SES_INBOUND_TOPIC_ARN", "AWS_SES_INBOUND_BUCKET", "AWS_SES_WEBHOOK_SECRET"])("fails closed without %s", async (key) => {
    await expect(receiveSesSns(envelope(), { ...env, [key]: "" }, dependencies)).rejects.toMatchObject({ statusCode: 503 });
    expect(verify).not.toHaveBeenCalled();
    expect(readObject).not.toHaveBeenCalled();
  });

  it("rejects a topic mismatch before certificate retrieval", async () => {
    await expect(receiveSesSns({ ...envelope(), TopicArn: `${env.AWS_SES_INBOUND_TOPIC_ARN}-other` }, env, dependencies)).rejects.toThrow("topic");
    expect(verify).not.toHaveBeenCalled();
  });

  it.each([
    "http://sns.us-east-1.amazonaws.com/SimpleNotificationService-test.pem",
    "https://sns.us-west-2.amazonaws.com/SimpleNotificationService-test.pem",
    "https://sns.us-east-1.amazonaws.com.evil.test/SimpleNotificationService-test.pem",
    "https://sns.us-east-1.amazonaws.com:8443/SimpleNotificationService-test.pem",
    "https://user@sns.us-east-1.amazonaws.com/SimpleNotificationService-test.pem",
    "https://sns.us-east-1.amazonaws.com/SimpleNotificationService-test.pem?redirect=1"
  ])("rejects unsafe signing certificate %s", async (SigningCertURL) => {
    await expect(receiveSesSns({ ...envelope(), SigningCertURL }, env, dependencies)).rejects.toThrow("certificate");
    expect(verify).not.toHaveBeenCalled();
    expect(readObject).not.toHaveBeenCalled();
  });

  it("rejects invalid signatures before accessing S3 or ingestion", async () => {
    verify.mockRejectedValueOnce(new Error("invalid signature"));
    await expect(receiveSesSns(envelope(), env, dependencies)).rejects.toThrow("signature verification failed");
    expect(readObject).not.toHaveBeenCalled();
    expect(ingest).not.toHaveBeenCalled();
  });

  it("validates subscription signatures and returns pending without fetching SubscribeURL", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    try {
      const result = await receiveSesSns({ ...envelope(), Type: "SubscriptionConfirmation", Token: "token", SubscribeURL: "http://127.0.0.1/admin" }, env, dependencies);
      expect(result).toEqual({ status: "PENDING_MANUAL_CONFIRMATION", receivingEnabled: false, topicArn: env.AWS_SES_INBOUND_TOPIC_ARN });
      expect(verify).toHaveBeenCalledOnce();
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(readObject).not.toHaveBeenCalled();
      expect(ingest).not.toHaveBeenCalled();
    } finally { fetchSpy.mockRestore(); }
  });

  it.each([
    { type: "S3", bucketName: "other-bucket", objectKey: "inbound/ses-123" },
    { type: "S3", bucketName: env.AWS_SES_INBOUND_BUCKET, objectKey: "private/ses-123" },
    { type: "S3", bucketName: env.AWS_SES_INBOUND_BUCKET, objectKey: "inbound/../private" },
    { type: "SNS", bucketName: env.AWS_SES_INBOUND_BUCKET, objectKey: "inbound/ses-123" }
  ])("rejects an unapproved S3 location %#", async (action) => {
    const message = receipt(); message.receipt.action = action;
    await expect(receiveSesSns({ ...envelope(), Message: JSON.stringify(message) }, env, dependencies)).rejects.toThrow("location");
    expect(readObject).not.toHaveBeenCalled();
  });

  it("enforces a configured prefix", async () => {
    await expect(receiveSesSns(envelope(), { ...env, AWS_SES_INBOUND_KEY_PREFIX: "restricted/" }, dependencies)).rejects.toThrow("location");
    expect(readObject).not.toHaveBeenCalled();
  });

  it("enforces ContentLength before reading and closes the stream", async () => {
    const stream = Readable.from([Buffer.from("small")]);
    await expect(receiveSesSns(envelope(), env, { ...dependencies,
      readObject: () => Promise.resolve({ ContentLength: MAX_INBOUND_MIME_BYTES + 1, Body: stream })
    })).rejects.toThrow("byte limit");
    expect(stream.destroyed).toBe(true);
    expect(parseMime).not.toHaveBeenCalled();
  });

  it("enforces streamed bytes when ContentLength is absent", async () => {
    await expect(receiveSesSns(envelope(), env, { ...dependencies,
      readObject: () => Promise.resolve({ Body: Readable.from([Buffer.alloc(MAX_INBOUND_MIME_BYTES), Buffer.from("x")]) })
    })).rejects.toThrow("byte limit");
    expect(ingest).not.toHaveBeenCalled();
  });

  it.each(["not-json", JSON.stringify({ notificationType: "Delivery" })])("rejects malformed receipt %#", async (Message) => {
    await expect(receiveSesSns({ ...envelope(), Message }, env, dependencies)).rejects.toThrow();
    expect(readObject).not.toHaveBeenCalled();
  });

  it("propagates storage failures without success", async () => {
    readObject.mockRejectedValueOnce(new Error("S3 unavailable"));
    await expect(receiveSesSns(envelope(), env, dependencies)).rejects.toThrow("S3 unavailable");
    expect(ingest).not.toHaveBeenCalled();
  });

  it("rejects a stalled stream without ingesting partial bytes", async () => {
    const stream = new Readable({ read() { this.push(Buffer.from("partial")); this._read = () => undefined; } });
    await expect(receiveSesSns(envelope(), { ...env, AWS_SES_TIMEOUT_MS: "20" }, {
      ...dependencies, readObject: () => Promise.resolve({ Body: stream })
    })).rejects.toThrow("timed out");
    expect(stream.destroyed).toBe(true);
    expect(parseMime).not.toHaveBeenCalled();
    expect(ingest).not.toHaveBeenCalled();
  });

  it("rejects missing or empty objects", async () => {
    await expect(receiveSesSns(envelope(), env, { ...dependencies, readObject: () => Promise.resolve({}) })).rejects.toThrow("unavailable");
    await expect(receiveSesSns(envelope(), env, { ...dependencies, readObject: () => Promise.resolve({ Body: Readable.from([]) }) })).rejects.toThrow("empty");
    expect(ingest).not.toHaveBeenCalled();
  });

  it("propagates core ingestion failure", async () => {
    ingest.mockRejectedValueOnce(new Error("core failed"));
    await expect(receiveSesSns(envelope(), env, dependencies)).rejects.toThrow("core failed");
  });
});

describe("stored SES attachment downloads", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  const stored = () => ({ receipt: { action: {
    bucketName: env.AWS_SES_INBOUND_BUCKET, objectKey: "inbound/ses-123"
  } } });
  const bytes = Buffer.from([0, 255, 128, 1]);
  const downloadParser = vi.fn(() => Promise.resolve({ ...mime, attachments: [
    { filename: "binary.dat", contentType: "application/octet-stream", size: bytes.length, content: bytes }
  ] }));
  const downloadDependencies = { readObject, parseMime: downloadParser };

  it("returns exact decoded bytes and matching metadata using the persisted S3 reference", async () => {
    const result = await downloadStoredSesAttachment(stored(), 0, env, downloadDependencies);
    expect(result).toEqual({ bytes, fileName: "binary.dat", contentType: "application/octet-stream" });
    expect(readObject).toHaveBeenCalledWith(expect.objectContaining({ bucket: env.AWS_SES_INBOUND_BUCKET, key: "inbound/ses-123" }));
    expect(verify).not.toHaveBeenCalled();
    expect(ingest).not.toHaveBeenCalled();
  });

  it.each([-1, 0.5, NaN, Infinity, 100, Number.MAX_SAFE_INTEGER + 1])("rejects invalid index %s before S3", async (index) => {
    await expect(downloadStoredSesAttachment(stored(), index, env, downloadDependencies)).rejects.toMatchObject({ statusCode: 404 });
    expect(readObject).not.toHaveBeenCalled();
  });

  it.each([undefined, null, {}, { receipt: {} }, { receipt: { action: null } }, { receipt: { action: { type: "E2E_LOCAL" } } }])("returns 404 for historical absent references %#", async (payload) => {
    await expect(downloadStoredSesAttachment(payload, 0, env, downloadDependencies)).rejects.toMatchObject({ statusCode: 404 });
    expect(readObject).not.toHaveBeenCalled();
  });

  it.each([
    { bucketName: "other-bucket", objectKey: "inbound/ses-123" },
    { bucketName: env.AWS_SES_INBOUND_BUCKET, objectKey: "private/ses-123" },
    { bucketName: env.AWS_SES_INBOUND_BUCKET, objectKey: "inbound/../secret" },
    { bucketName: env.AWS_SES_INBOUND_BUCKET, objectKey: "inbound/" },
    { bucketName: env.AWS_SES_INBOUND_BUCKET, objectKey: "inbound/secret\\file" }
  ])("rejects unapproved persisted locations %# before S3", async (action) => {
    await expect(downloadStoredSesAttachment({ receipt: { action } }, 0, env, downloadDependencies)).rejects.toMatchObject({ statusCode: 403 });
    expect(readObject).not.toHaveBeenCalled();
  });

  it.each(["AWS_SES_INBOUND_BUCKET", "AWS_SES_INBOUND_TOPIC_ARN", "AWS_SES_WEBHOOK_SECRET"])("requires pinned configuration %s", async (key) => {
    await expect(downloadStoredSesAttachment(stored(), 0, { ...env, [key]: "" }, downloadDependencies)).rejects.toMatchObject({ statusCode: 503 });
    expect(readObject).not.toHaveBeenCalled();
  });

  it("returns 404 when the attachment index exceeds the parsed MIME count", async () => {
    await expect(downloadStoredSesAttachment(stored(), 1, env, downloadDependencies)).rejects.toMatchObject({ statusCode: 404 });
  });

  it("returns 404 when parsed attachment bytes are absent", async () => {
    await expect(downloadStoredSesAttachment(stored(), 0, env, { ...downloadDependencies, parseMime })).rejects.toMatchObject({ statusCode: 404 });
  });

  it.each([{ name: "NoSuchKey" }, { name: "NotFound" }, { $metadata: { httpStatusCode: 404 } }])("returns 404 when the S3 original is absent %#", async (error) => {
    await expect(downloadStoredSesAttachment(stored(), 0, env, { ...downloadDependencies,
      readObject: () => Promise.reject(Object.assign(new Error("S3 original is absent"), error))
    })).rejects.toMatchObject({ statusCode: 404 });
    expect(downloadParser).not.toHaveBeenCalled();
  });

  it("rejects a streamed oversized original before parsing", async () => {
    await expect(downloadStoredSesAttachment(stored(), 0, env, { ...downloadDependencies,
      readObject: () => Promise.resolve({ Body: Readable.from([Buffer.alloc(MAX_INBOUND_MIME_BYTES + 1)]) })
    })).rejects.toMatchObject({ statusCode: 413 });
    expect(downloadParser).not.toHaveBeenCalled();
  });

  it("enforces the deadline while waiting for S3 headers", async () => {
    await expect(downloadStoredSesAttachment(stored(), 0, { ...env, AWS_SES_TIMEOUT_MS: "20" }, {
      ...downloadDependencies, readObject: () => new Promise(() => undefined)
    })).rejects.toMatchObject({ statusCode: 504 });
    expect(downloadParser).not.toHaveBeenCalled();
  });

  it("enforces the deadline on stalled S3 bodies", async () => {
    const stream = new Readable({ read() { /* Simulate a provider that never completes. */ } });
    await expect(downloadStoredSesAttachment(stored(), 0, { ...env, AWS_SES_TIMEOUT_MS: "20" }, {
      ...downloadDependencies, readObject: () => Promise.resolve({ Body: stream })
    })).rejects.toMatchObject({ statusCode: 504 });
    expect(stream.destroyed).toBe(true);
    expect(downloadParser).not.toHaveBeenCalled();
  });
});
