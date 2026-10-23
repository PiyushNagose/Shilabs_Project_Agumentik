import { describe, expect, it } from "vitest";
import { classifyInboundEmail, isNonMeaningfulInboundMetadata } from "./inbound-email-classification.js";

function classify(subject: string, textBody: string, headers: Record<string, string> = {}) {
  return classifyInboundEmail({ subject, textBody, header: (name) => headers[name] });
}

describe("inbound email classification", () => {
  it.each(["auto-replied", "Auto-Generated; owner-email=bot@example.com"])("uses Auto-Submitted %s", (value) => {
    expect(classify("Re: Proposal", "An automatic response", { "auto-submitted": value }).kind)
      .toBe("NONMEANINGFUL");
  });

  it.each(["delivery-status", "disposition-notification"])("recognizes %s reports", (type) => {
    expect(classify("Mail report", "", { "content-type": `multipart/report; boundary=abc; report-type="${type}"` }).reason)
      .toBe("MAIL_SYSTEM_REPORT");
  });

  it("requires combined mailing list signals", () => {
    const headers = { "list-id": "<news.example.com>", "list-unsubscribe": "<mailto:leave@example.com>", precedence: "bulk" };
    expect(classify("Newsletter", "News", headers).kind).toBe("NONMEANINGFUL");
    expect(classify("Client mailing list discussion", "Please send a quote", { "list-id": headers["list-id"] }).kind).toBe("MEANINGFUL");
    expect(classify("Proposal", "Please send a quote", { precedence: "bulk" }).kind).toBe("MEANINGFUL");
  });

  it.each([
    ["Out of office", "Thank you for your email. I am currently out of the office. I will return on Monday."],
    ["Automatic reply: Proposal", "This is an automated reply. Your email has been received."]
  ])("recognizes the complete template %s", (subject, body) => {
    expect(classify(subject, body).kind).toBe("NONMEANINGFUL");
  });

  it.each([
    ["Re: Out of office", "Yes, send the proposal.\n> I am out of the office."],
    ["Out of office", "Please send pricing.\nOn Monday, Alex wrote:\nI am out of the office."],
    ["Out of office", "I am out of the office. But I approve the proposal."],
    ["Out of office", "I am out of the office.\n> Auto-Submitted: auto-replied"],
    ["Proposal", "I am out of the office."],
    ["Delivery failure discussion", "Please fix the bounce and send pricing."],
    ["Newsletter", "I would like to buy your newsletter service."],
    ["Re: Proposal", "Stop emailing me."]
  ])("retains uncertain or human mail: %s", (subject, body) => {
    expect(classify(subject, body).kind).toBe("MEANINGFUL");
  });

  it("honors explicit human origin and ignores response-suppression headers", () => {
    expect(classify("Out of office", "I am out of the office.", { "auto-submitted": "no" }).kind).toBe("MEANINGFUL");
    expect(classify("Re: Proposal", "Approved", { "x-auto-response-suppress": "All" }).kind).toBe("MEANINGFUL");
  });

  it("only filters explicitly versioned metadata, preserving legacy messages", () => {
    expect(isNonMeaningfulInboundMetadata({ inboundClassification: classify("Out of office", "I am out of the office.") })).toBe(true);
    for (const metadata of [null, {}, { inboundClassification: { kind: "NONMEANINGFUL" } }]) {
      expect(isNonMeaningfulInboundMetadata(metadata)).toBe(false);
    }
  });
});
