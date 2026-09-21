import { createWorkerRuntime } from "./runtime.js";

describe("worker runtime", () => {
  it("reports degraded queue status when Redis is not configured", () => {
    expect(createWorkerRuntime({})).toMatchObject({
      status: "degraded",
      service: "worker",
      queuesEnabled: false,
      redisStatus: "NOT_CONFIGURED"
    });
  });

  it("enables queues when Redis is configured", () => {
    expect(createWorkerRuntime({ REDIS_URL: "redis://localhost:6380" })).toMatchObject({
      status: "ok",
      service: "worker",
      queuesEnabled: true,
      redisStatus: "CONFIGURED",
      domainEventQueueName: "domain-events"
    });
  });
});
