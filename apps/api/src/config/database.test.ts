import { getDatabaseConfig } from "./database.js";

describe("database config", () => {
  it("requires DATABASE_URL", () => {
    expect(() => getDatabaseConfig({})).toThrow("DATABASE_URL is required");
  });

  it("returns configured DATABASE_URL", () => {
    expect(getDatabaseConfig({ DATABASE_URL: "postgresql://user:pass@localhost:5432/db" })).toEqual(
      {
        databaseUrl: "postgresql://user:pass@localhost:5432/db"
      }
    );
  });
});
