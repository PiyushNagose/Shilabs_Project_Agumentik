import { PrismaClient, Prisma } from "@prisma/client";

describe("prisma generated client", () => {
  it("exports the generated client and model metadata", () => {
    expect(PrismaClient).toBeDefined();
    expect(Prisma.dmmf.datamodel.models.map((model) => model.name)).toEqual(
      expect.arrayContaining([
        "User",
        "Company",
        "Contact",
        "Lead",
        "PipelineStage",
        "Deal",
        "Activity",
        "AuditEvent"
      ])
    );
  });
});
