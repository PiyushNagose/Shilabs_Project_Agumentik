import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp, isCorsOriginAllowed } from "./app.js";
import type { ApiConfig } from "@shilabs/shared-config";

const apiConfig: ApiConfig = {
  host: "0.0.0.0",
  port: 4000,
  nodeEnv: "development",
  webOrigin: "http://localhost:5173"
};

describe("api health endpoints", () => {
  const app = createApp();

  it("returns health status", async () => {
    const response = await request(app).get("/health").expect(200);

    expect(response.body).toMatchObject({
      status: "ok",
      service: "api"
    });
  });

  it("returns readiness status", async () => {
    const response = await request(app).get("/ready").expect(200);

    expect(response.body).toMatchObject({
      status: "ok",
      service: "api"
    });
  });
});

describe("api CORS", () => {
  it("allows the configured web origin", () => {
    expect(isCorsOriginAllowed("http://localhost:5173", apiConfig)).toBe(true);
  });

  it("allows alternate localhost ports in development", () => {
    expect(isCorsOriginAllowed("http://localhost:5174", apiConfig)).toBe(true);
    expect(isCorsOriginAllowed("http://127.0.0.1:5174", apiConfig)).toBe(true);
  });

  it("keeps non-local origins blocked in development", () => {
    expect(isCorsOriginAllowed("https://example.com", apiConfig)).toBe(false);
  });

  it("keeps production limited to the configured origin", () => {
    expect(
      isCorsOriginAllowed("http://localhost:5174", {
        ...apiConfig,
        nodeEnv: "production"
      })
    ).toBe(false);
  });

  it("sets CORS headers for Vite fallback ports in development", async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "development";
    const app = createApp();

    const response = await request(app)
      .options("/api/auth/login")
      .set("Origin", "http://localhost:5174")
      .set("Access-Control-Request-Method", "POST");
    process.env.NODE_ENV = originalNodeEnv;

    expect(response.headers["access-control-allow-origin"]).toBe("http://localhost:5174");
  });
});
