import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { AuthenticatedUser } from "../auth/auth.types.js";
import { getMessagingConfig } from "@shilabs/shared-config";
import { downloadStoredSesAttachment } from "../email/email-ses-receiving.service.js";
import {
  downloadConversationAttachment,
  MAX_ATTACHMENT_BYTES
} from "./conversation-attachments.service.js";

const database = vi.hoisted(() => ({
  conversation: { findUnique: vi.fn() },
  message: { findFirst: vi.fn() },
  inboundEmail: { findFirst: vi.fn() }
}));
vi.mock("../../shared/prisma.js", () => ({
  prisma: database
}));
vi.mock("@shilabs/shared-config", () => ({ getMessagingConfig: vi.fn() }));
vi.mock("../email/email-ses-receiving.service.js", () => ({ downloadStoredSesAttachment: vi.fn() }));

const actor = { id: "rep", role: "SALES_REP", activeWorkspaceId: "workspace" } as AuthenticatedUser;
const accountSid = `AC${"a".repeat(32)}`;
const messageSid = `SM${"b".repeat(32)}`;
const mediaSid = `ME${"c".repeat(32)}`;
const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages/${messageSid}/Media/${mediaSid}`;
const fetchMock = vi.fn<typeof fetch>();
let conversation: {
  workspaceId: string;
  channel: string;
  lead: { ownerId: string; workspaceId: string };
};
let message: {
  conversationId: string;
  workspaceId: string;
  providerMessageId: string;
  metadata: { provider: string };
  attachmentMetadata: [Record<string, unknown>];
};
const download = (user = actor, index = "0") =>
  downloadConversationAttachment(user, "conversation", "message", index);

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("fetch", fetchMock);
  conversation = {
    workspaceId: "workspace",
    channel: "WHATSAPP",
    lead: { ownerId: "rep", workspaceId: "workspace" }
  };
  message = {
    conversationId: "conversation",
    workspaceId: "workspace",
    providerMessageId: messageSid,
    metadata: { provider: "META_WHATSAPP" },
    attachmentMetadata: [
      {
        fileName: '../bad"\r\nname.png',
        contentType: "image/png",
        sizeBytes: 0,
        providerAttachmentId: "123456"
      }
    ]
  };
  database.conversation.findUnique.mockResolvedValue(conversation);
  database.message.findFirst.mockResolvedValue(message);
  database.inboundEmail.findFirst.mockResolvedValue(null);
  vi.mocked(getMessagingConfig).mockReturnValue({
    metaWhatsApp: {
      graphApiBaseUrl: "https://graph.facebook.com/v20.0",
      accessToken: "server-meta-token"
    },
    twilioWhatsApp: { accountSid, authToken: "server-twilio-token" }
  } as ReturnType<typeof getMessagingConfig>);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function metaResolution(url = "https://lookaside.fbsbx.com/media/123") {
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ url })));
}

describe("conversation attachment proxy (no database or live provider)", () => {
  it("downloads email bytes only from the workspace-scoped persisted SES reference", async () => {
    conversation.channel = "EMAIL";
    const rawProviderPayload = { receipt: { action: { bucketName: "mail", objectKey: "inbound/raw" } } };
    database.inboundEmail.findFirst.mockResolvedValue({ rawProviderPayload });
    vi.mocked(downloadStoredSesAttachment).mockResolvedValue({ bytes: Buffer.from("pdf"), fileName: "../scope.pdf", contentType: "application/pdf" });
    await expect(download()).resolves.toMatchObject({ bytes: Buffer.from("pdf"), fileName: "_scope.pdf", contentType: "application/pdf" });
    expect(database.inboundEmail.findFirst).toHaveBeenCalledWith({ where: { messageId: "message", conversationId: "conversation", workspaceId: "workspace", provider: "AWS_SES" }, select: { rawProviderPayload: true } });
    expect(downloadStoredSesAttachment).toHaveBeenCalledWith(rawProviderPayload, 0);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("resolves Meta media IDs on Graph and downloads bounded bytes with server credentials", async () => {
    metaResolution();
    fetchMock.mockResolvedValueOnce(
      new Response("image bytes", { headers: { "content-type": "image/png" } })
    );
    const result = await download();
    expect(result.bytes.toString()).toBe("image bytes");
    expect(result.fileName).not.toMatch(/[/"\r\n]/);
    expect(result.contentType).toBe("image/png");
    expect(fetchMock.mock.calls[0]?.[0]).toEqual(
      new URL("https://graph.facebook.com/v20.0/123456")
    );
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      redirect: "error",
      headers: { Authorization: "Bearer server-meta-token" }
    });
  });

  it.each([
    "https://evil.test/a",
    "http://lookaside.fbsbx.com/a",
    "https://lookaside.fbsbx.com.evil.test/a",
    "https://u:p@lookaside.fbsbx.com/a",
    "https://lookaside.fbsbx.com:444/a",
    "https://fbcdn.net/a"
  ])("rejects untrusted Meta URL %s before forwarding credentials", async (url) => {
    metaResolution(url);
    await expect(download()).rejects.toMatchObject({ statusCode: 404 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each(["https://platform-lookaside.fbsbx.com/a", "https://scontent.xx.fbcdn.net/a"])(
    "accepts allowed Meta binary host %s",
    async (url) => {
      metaResolution(url);
      fetchMock.mockResolvedValueOnce(new Response("bytes"));
      expect((await download()).bytes.length).toBe(5);
    }
  );

  it("fetches only a canonical Twilio resource belonging to the configured account and stored message", async () => {
    message.metadata.provider = "TWILIO_WHATSAPP";
    message.attachmentMetadata[0].providerAttachmentId = twilioUrl;
    fetchMock.mockResolvedValueOnce(new Response("twilio bytes"));
    await download();
    expect(fetchMock.mock.calls[0]?.[0]).toEqual(new URL(twilioUrl));
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      redirect: "manual",
      headers: {
        Authorization: `Basic ${Buffer.from(`${accountSid}:server-twilio-token`).toString("base64")}`
      }
    });
  });

  it("follows the secure Twilio CDN redirect without forwarding account credentials", async () => {
    message.metadata.provider = "TWILIO_WHATSAPP";
    message.attachmentMetadata[0].providerAttachmentId = twilioUrl;
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 307, headers: { location: "https://mms.twiliocdn.com/signed-media?signature=test" } }));
    fetchMock.mockResolvedValueOnce(new Response("secure media", { headers: { "content-type": "image/png" } }));
    expect((await download()).bytes.toString()).toBe("secure media");
    expect(fetchMock.mock.calls[1]?.[1]).not.toHaveProperty("headers");
    expect(fetchMock.mock.calls[1]?.[1]?.redirect).toBe("error");
  });

  it("blocks a Twilio redirect to an untrusted host", async () => {
    message.metadata.provider = "TWILIO_WHATSAPP";
    message.attachmentMetadata[0].providerAttachmentId = twilioUrl;
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 307, headers: { location: "https://untrusted.example/media" } }));
    await expect(download()).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    twilioUrl.replace(accountSid, `AC${"d".repeat(32)}`),
    twilioUrl.replace(messageSid, `SM${"e".repeat(32)}`),
    twilioUrl.replace("api.twilio.com", "evil.test"),
    `${twilioUrl}?target=evil`,
    `${twilioUrl}.json`
  ])("rejects invalid Twilio resource %s", async (url) => {
    message.metadata.provider = "TWILIO_WHATSAPP";
    message.attachmentMetadata[0].providerAttachmentId = url;
    await expect(download()).rejects.toMatchObject({ statusCode: 404 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("checks lead ownership before querying message or contacting provider", async () => {
    conversation.lead.ownerId = "other-rep";
    await expect(download()).rejects.toMatchObject({ statusCode: 403 });
    expect(database.message.findFirst).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects cross-workspace leads even for managers", async () => {
    conversation.lead.workspaceId = "other-workspace";
    await expect(download({ ...actor, role: "ADMIN" })).rejects.toMatchObject({ statusCode: 403 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("requires an active workspace", async () => {
    await expect(download({ ...actor, activeWorkspaceId: undefined })).rejects.toMatchObject({
      statusCode: 403
    });
    expect(database.conversation.findUnique).not.toHaveBeenCalled();
  });

  it.each(["conversation", "workspace", "message-conversation", "message-workspace"])(
    "rejects mismatched stored ownership: %s",
    async (target) => {
      if (target === "conversation") database.conversation.findUnique.mockResolvedValueOnce(null);
      if (target === "workspace") conversation.workspaceId = "other";
      if (target === "message-conversation") message.conversationId = "other";
      if (target === "message-workspace") message.workspaceId = "other";
      await expect(download()).rejects.toMatchObject({ statusCode: 404 });
      expect(fetchMock).not.toHaveBeenCalled();
    }
  );

  it.each(["-1", "1.1", "1e0", "01", "99999999999999999999999", "1"])(
    "rejects invalid or missing attachment index %s",
    async (index) => {
      await expect(download(actor, index)).rejects.toMatchObject({ statusCode: 404 });
      expect(fetchMock).not.toHaveBeenCalled();
    }
  );

  it("returns a clear unavailable 404 for email metadata without bytes", async () => {
    conversation.channel = "EMAIL";
    await expect(download()).rejects.toMatchObject({
      statusCode: 404,
      message: "Attachment bytes are unavailable"
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects arbitrary media IDs and unknown providers", async () => {
    message.attachmentMetadata[0].providerAttachmentId = "https://evil.test";
    await expect(download()).rejects.toMatchObject({ statusCode: 404 });
    message.metadata.provider = "EMAIL";
    await expect(download()).rejects.toMatchObject({ statusCode: 404 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("enforces advertised and streamed byte limits", async () => {
    metaResolution();
    fetchMock.mockResolvedValueOnce(
      new Response("x", { headers: { "content-length": String(MAX_ATTACHMENT_BYTES + 1) } })
    );
    await expect(download()).rejects.toMatchObject({ statusCode: 413 });
    metaResolution();
    fetchMock.mockResolvedValueOnce(new Response(new Uint8Array(MAX_ATTACHMENT_BYTES + 1)));
    await expect(download()).rejects.toMatchObject({ statusCode: 413 });
  });

  it("uses a deadline and returns a safe provider error on timeout", async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementationOnce(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new Error("secret provider detail"))
          );
        })
    );
    const result = expect(download()).rejects.toMatchObject({
      statusCode: 502,
      message: "Attachment download failed or timed out"
    });
    await vi.advanceTimersByTimeAsync(15_000);
    await result;
  });

  it("does not follow redirects or expose provider error details", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("redirect to secret URL"));
    await expect(download()).rejects.toMatchObject({
      statusCode: 502,
      message: "Attachment download failed or timed out"
    });
    expect(fetchMock.mock.calls[0]?.[1]?.redirect).toBe("error");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("downgrades executable MIME types to octet-stream", async () => {
    metaResolution();
    fetchMock.mockResolvedValueOnce(
      new Response("<svg/>", { headers: { "content-type": "image/svg+xml" } })
    );
    expect((await download()).contentType).toBe("application/octet-stream");
  });
});
