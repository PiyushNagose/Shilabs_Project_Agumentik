/** @vitest-environment happy-dom */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CommunicationAttachmentDto } from "@shilabs/shared-types";
import { ConversationAttachment } from "./ConversationAttachment.js";

const fetchMock = vi.fn<typeof fetch>();
const createUrl = vi.fn(() => "blob:attachment-test");
const revokeUrl = vi.fn();
const props = {
  accessToken: "access-token",
  conversationId: "conversation",
  messageId: "message",
  index: 0,
  attachment: {
    fileName: "sample.png",
    contentType: "image/png",
    sizeBytes: 0,
    contentId: null,
    disposition: "attachment",
    providerAttachmentId: "https://untrusted.test/never-fetch"
  } as CommunicationAttachmentDto
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(URL, "createObjectURL").mockImplementation(createUrl);
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(revokeUrl);
  createUrl.mockReturnValue("blob:attachment-test");
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("ConversationAttachment", () => {
  it("waits for a click, authenticates the proxy request, previews a blob and revokes it on unmount", async () => {
    fetchMock.mockResolvedValue(
      new Response("image", { headers: { "content-type": "image/png" } })
    );
    const view = render(<ConversationAttachment {...props} />);
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Load attachment" }));
    const image = await screen.findByRole<HTMLImageElement>("img");
    expect(image.src).toBe("blob:attachment-test");
    expect(fetchMock.mock.calls[0]?.[0]).toContain(
      "/api/conversations/conversation/messages/message/attachments/0/download"
    );
    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get("Authorization")).toBe(
      "Bearer access-token"
    );
    const link = screen.getByRole<HTMLAnchorElement>("link", { name: "Download" });
    expect(link.href).toBe("blob:attachment-test");
    expect(link.download).toBe("sample.png");
    view.unmount();
    expect(revokeUrl).toHaveBeenCalledWith("blob:attachment-test");
  });

  it.each(["audio/ogg", "video/mp4"])("previews %s after a click", async (type) => {
    fetchMock.mockResolvedValue(new Response("media", { headers: { "content-type": type } }));
    const { container } = render(<ConversationAttachment {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Load attachment" }));
    await screen.findByRole("link", { name: "Download" });
    const media = container.querySelector<HTMLMediaElement>(
      type.startsWith("audio") ? "audio" : "video"
    );
    expect(media?.src).toBe("blob:attachment-test");
    expect(media?.controls).toBe(true);
  });

  it("shows unavailable errors and permits retry", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { message: "Attachment bytes are unavailable" } }), {
        status: 404
      })
    );
    render(<ConversationAttachment {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Load attachment" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Attachment bytes are unavailable");
    expect(createUrl).not.toHaveBeenCalled();
    fetchMock.mockResolvedValueOnce(new Response("bytes"));
    fireEvent.click(screen.getByRole("button", { name: "Load attachment" }));
    await screen.findByRole("link", { name: "Download" });
  });

  it("aborts pending downloads and creates no blob URL after unmount", async () => {
    let resolveResponse!: (value: Response) => void;
    fetchMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveResponse = resolve;
        })
    );
    const view = render(<ConversationAttachment {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Load attachment" }));
    const signal = fetchMock.mock.calls[0]?.[1]?.signal;
    view.unmount();
    expect(signal?.aborted).toBe(true);
    resolveResponse(new Response("image", { headers: { "content-type": "image/png" } }));
    await waitFor(() => expect(createUrl).not.toHaveBeenCalled());
  });

  it("discards loaded bytes when the active conversation or token changes", async () => {
    fetchMock.mockResolvedValue(
      new Response("image", { headers: { "content-type": "image/png" } })
    );
    const view = render(<ConversationAttachment {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Load attachment" }));
    await screen.findByRole("img");
    view.rerender(<ConversationAttachment {...props} accessToken="another-token" />);
    expect(revokeUrl).toHaveBeenCalledWith("blob:attachment-test");
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByRole("button", { name: "Load attachment" })).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
