import { PrismaClient, Prisma } from "@prisma/client";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { migrationEnvironment } = require("../../../../scripts/run-prisma.cjs") as {
  migrationEnvironment: (env: NodeJS.ProcessEnv) => NodeJS.ProcessEnv;
};

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

  it("uses a direct connection only in the migration process", () => {
    const env = {
      DATABASE_URL: "postgresql://user:password@pooler.example/crm",
      DIRECT_DATABASE_URL: "postgresql://user:password@direct.example/crm"
    };
    expect(migrationEnvironment(env).DATABASE_URL).toBe(env.DIRECT_DATABASE_URL);
    expect(env.DATABASE_URL).toBe("postgresql://user:password@pooler.example/crm");
  });

  it("preserves the configured connection when no direct connection is supplied", () => {
    const env = { DATABASE_URL: "postgresql://localhost/crm", DIRECT_DATABASE_URL: " " };
    expect(migrationEnvironment(env)).toEqual(env);
  });
});
