import { getMessagingConfig } from "@shilabs/shared-config";
import { describe, expect, it, vi } from "vitest";
import { sendWhatsAppText } from "./messaging.provider.js";

const config = getMessagingConfig({
  MESSAGING_PROVIDER: "meta_whatsapp",
  WHATSAPP_ACCESS_TOKEN: "test-token",
  WHATSAPP_PHONE_NUMBER_ID: "test-phone-id"
});
const input = { to: "+919876543210", body: "Hello", idempotencyKey: "manual-test-key" };

describe("manual WhatsApp provider delivery", () => {
  it("returns the provider message ID on acceptance", async () => {
    const transport = vi.fn(() => Promise.resolve(Response.json({ messages: [{ id: "wamid.test" }] })));
    await expect(sendWhatsAppText(config, input, transport as unknown as typeof fetch))
      .resolves.toMatchObject({ status: "ACCEPTED", providerMessageId: "wamid.test" });
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("does not treat a timeout or server error as a confirmed failure", async () => {
    const timeout = vi.fn(() => Promise.reject(new Error("timeout")));
    const serverError = vi.fn(() => Promise.resolve(Response.json({ error: { message: "unavailable" } }, { status: 503 })));
    await expect(sendWhatsAppText(config, input, timeout as unknown as typeof fetch))
      .resolves.toMatchObject({ status: "UNCERTAIN" });
    await expect(sendWhatsAppText(config, input, serverError as unknown as typeof fetch))
      .resolves.toMatchObject({ status: "UNCERTAIN" });
    expect(timeout).toHaveBeenCalledTimes(1);
    expect(serverError).toHaveBeenCalledTimes(1);
  });

  it("returns failure for a provider rejection without retrying", async () => {
    const transport = vi.fn(() => Promise.resolve(Response.json({ error: { message: "Bad recipient" } }, { status: 400 })));
    await expect(sendWhatsAppText(config, input, transport as unknown as typeof fetch))
      .resolves.toMatchObject({ status: "FAILED" });
    expect(transport).toHaveBeenCalledTimes(1);
  });
});
