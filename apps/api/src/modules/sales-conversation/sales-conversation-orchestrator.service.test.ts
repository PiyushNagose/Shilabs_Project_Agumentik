import { describe, expect, it } from "vitest";
import { removeInternalIdentifiers } from "./sales-conversation-orchestrator.service.js";

describe("sales conversation outbound safety", () => {
  it("removes persisted internal identifiers from customer-visible text", () => {
    const internalId = "cmv92diqh0di5a20vborv2eu";

    expect(
      removeInternalIdentifiers(
        `Your request is awaiting confirmation as per message ${internalId}.`,
        [internalId]
      )
    ).toBe("Your request is awaiting confirmation as per message the customer request.");
  });

  it("does not replace short business values", () => {
    expect(removeInternalIdentifiers("Reference Q1 is approved.", ["Q1", null])).toBe(
      "Reference Q1 is approved."
    );
  });
});
