import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { assertTestDatabaseEnvironment } = require("./verify-test-environment.cjs") as {
  assertTestDatabaseEnvironment: (env: NodeJS.ProcessEnv) => void;
};

export function setup(): void {
  assertTestDatabaseEnvironment(process.env);
}
