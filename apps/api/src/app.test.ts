import request from "supertest";
import { createApp } from "./app.js";

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
