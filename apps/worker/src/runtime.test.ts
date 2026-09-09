import { createWorkerRuntime } from "./runtime.js";

describe("worker runtime", () => {
  it("boots without queue processors in M0", () => {
    expect(createWorkerRuntime()).toMatchObject({
      status: "ok",
      service: "worker",
      queuesEnabled: false
    });
  });
});
