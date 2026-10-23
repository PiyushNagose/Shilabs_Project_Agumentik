import { describe, expect, it, vi } from "vitest";
import { MAX_INBOUND_MIME_BYTES, parseInboundMime, type ParsedInboundMime } from "./email-ses-receiving.mime.js";

describe("bounded MIME mapping", () => {
  const empty: ParsedInboundMime = { headerLines: [], attachments: [] };

  it("maps decoded multipart text, HTML, grouped addresses, threading, and attachment metadata", async () => {
    const parser = vi.fn(() => Promise.resolve({ ...empty,
      text: "Decoded = reply", html: "<p>Decoded = reply</p>", subject: "Encoded subject decoded",
      from: { value: [{ address: "from@example.com" }] },
      to: [{ value: [{ group: [{ address: "to@example.com" }] }] }],
      headerLines: [{ key: "references", line: "References: <one>\r\n\t<two>" }],
      attachments: [{ filename: "image.png", contentType: "image/png", size: 5, contentId: "logo", contentDisposition: "inline" }]
    }));
    const raw = Buffer.from("binary MIME");
    const parsed = await parseInboundMime(raw, parser);
    expect(parser).toHaveBeenCalledWith(raw);
    expect(parsed.textBody).toBe("Decoded = reply");
    expect(parsed.headers.get("references")).toBe("<one> <two>");
    expect(parsed.commonHeaders.to).toEqual(["to@example.com"]);
    expect(parsed.attachments).toEqual([{ fileName: "image.png", contentType: "image/png", sizeBytes: 5, contentId: "logo", disposition: "inline" }]);
  });

  it("rejects oversized input before invoking the parser", async () => {
    const parser = vi.fn(() => Promise.resolve(empty));
    await expect(parseInboundMime(Buffer.alloc(MAX_INBOUND_MIME_BYTES + 1), parser)).rejects.toThrow("byte limit");
    expect(parser).not.toHaveBeenCalled();
  });

  it("rejects parser errors", async () => {
    await expect(parseInboundMime(Buffer.from("raw"), () => Promise.reject(new Error("bad MIME")))).rejects.toThrow("could not be parsed");
  });

  it("rejects excessive attachment counts", async () => {
    await expect(parseInboundMime(Buffer.from("raw"), () => Promise.resolve({ ...empty,
      attachments: Array.from({ length: 101 }, () => ({ contentType: "text/plain", size: 1 }))
    }))).rejects.toThrow("too many attachments");
  });
});
