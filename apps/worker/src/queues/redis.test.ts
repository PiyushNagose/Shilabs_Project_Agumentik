import { describe, expect, it } from "vitest";
import { redisConnectionFromUrl } from "./redis.js";

describe("redisConnectionFromUrl", () => {
  it("parses local Redis URLs", () => {
    expect(redisConnectionFromUrl("redis://localhost:6380/2")).toMatchObject({
      host: "localhost",
      port: 6380,
      db: 2
    });
  });

  it("rejects unsupported protocols", () => {
    expect(() => redisConnectionFromUrl("http://localhost:6379")).toThrow("REDIS_URL");
  });
});
