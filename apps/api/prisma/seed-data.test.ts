import { pipelineStages } from "./seed-data.js";

describe("pipeline stage seed data", () => {
  it("contains the canonical M1 stage keys in order", () => {
    expect(pipelineStages.map((stage) => stage.key)).toEqual([
      "NEW",
      "CONTACTED",
      "ENGAGED",
      "QUALIFIED",
      "MEETING_BOOKED",
      "PROPOSAL",
      "NEGOTIATION",
      "WON",
      "LOST",
      "NURTURE"
    ]);
  });

  it("uses sensible probabilities and terminal flags", () => {
    expect(
      pipelineStages.every((stage) => stage.probability >= 0 && stage.probability <= 100)
    ).toBe(true);
    expect(pipelineStages.find((stage) => stage.key === "WON")).toMatchObject({
      probability: 100,
      isClosed: true,
      isWon: true,
      isLost: false
    });
    expect(pipelineStages.find((stage) => stage.key === "LOST")).toMatchObject({
      probability: 0,
      isClosed: true,
      isWon: false,
      isLost: true
    });
  });
});
