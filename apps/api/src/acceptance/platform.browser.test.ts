import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { createServer, type Server } from "node:http";
import { createRequire } from "node:module";
import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it, vi } from "vitest";
import type { AuthResponse } from "@shilabs/shared-types";
import { adapterMetadata, aiCalls, calendarCalls } from "./browser-adapters.js";

vi.mock("../modules/ai/ai.factory.js", async () => {
  const { browserAIProvider } = await import("./browser-adapters.js");
  return { createAIProvider: () => browserAIProvider };
});

vi.mock("../modules/calendar/calendar.provider.js", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../modules/calendar/calendar.provider.js")>();
  const { browserCalendarProvider } = await import("./browser-adapters.js");
  return { ...original, createCalendarProvider: () => browserCalendarProvider };
});

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const schema = process.env.LOCAL_TEST_SCHEMA ?? "codex_test_browser_20261018";
const localHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);

async function freePort(): Promise<number> {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No local port allocated");
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve()))
  );
  return address.port;
}

async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null || !child.pid) return;
  const exited = once(child, "exit");
  if (process.platform === "win32") {
    const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore"
    });
    await once(killer, "exit");
  } else {
    child.kill("SIGTERM");
  }
  await exited;
}

async function waitForUrl(url: string, child: ChildProcess): Promise<void> {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error("Temporary Vite exited before readiness");
    if (
      await fetch(url).then(
        (response) => response.ok,
        () => false
      )
    )
      return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Temporary Vite did not become ready");
}

describe.skipIf(process.env.RUN_BROWSER_ACCEPTANCE !== "true")(
  "Persisted platform browser acceptance (TEST ADAPTERS)",
  () => {
    it(
      "runs the 22 manager steps with isolated state and local providers",
      async () => {
        const { assertTestDatabaseEnvironment } = require(
          path.join(root, "scripts/verify-test-environment.cjs")
        ) as {
          assertTestDatabaseEnvironment: (env: NodeJS.ProcessEnv) => void;
        };
        assertTestDatabaseEnvironment(process.env);
        const database = new URL(process.env.DATABASE_URL ?? "");
        expect(localHosts.has(database.hostname)).toBe(true);
        expect(schema).toMatch(/^codex_test_[A-Za-z0-9_]+$/);
        expect(database.searchParams.get("schema")).toBe(schema);
        expect(process.env.LOCAL_TEST_SCHEMA).toBe(schema);
        const redis = new URL(process.env.REDIS_URL ?? "");
        expect(localHosts.has(redis.hostname)).toBe(true);
        expect(redis.pathname).toBe("/1");

        const { parse } = require("dotenv") as {
          parse: (source: Buffer) => Record<string, string>;
        };
        const settings: Record<string, string> = {};
        for (const name of [".env"]) {
          Object.assign(settings, await readFile(path.join(root, name)).then(parse, () => ({})));
        }
        const outputDir = await mkdtemp(path.join(tmpdir(), "shilabs-browser-test-adapters-"));
        console.info("Browser acceptance", { ...adapterMetadata, schema, outputDir });
        // Clear inherited provider settings before importing any production modules.
        for (const key of new Set([...Object.keys(process.env), ...Object.keys(settings)])) {
          if (
            /^(OPENAI_|GEMINI_|GOOGLE_|MICROSOFT_|ZOOM_|ZOHO_|AWS_|TWILIO_|EXOTEL_|WHATSAPP_|SEMRUSH_|OPS_ALERT_)/.test(
              key
            )
          ) {
            vi.stubEnv(key, "");
          }
        }
        const webPort = await freePort();
        const webUrl = `http://127.0.0.1:${String(webPort)}`;
        const overrides = {
          APP_ENV: "e2e-local",
          LEAD_ACK_ON_CREATE_IN_TEST: "true",
          LEAD_ACK_ON_CREATE: "true",
          NODE_ENV: "test",
          WEB_ORIGIN: webUrl,
          EMAIL_PROVIDER: "MAILPIT",
          MAILPIT_SMTP_HOST: settings.MAILPIT_SMTP_HOST ?? "localhost",
          MAILPIT_SMTP_PORT: settings.MAILPIT_SMTP_PORT ?? "1025",
          MAILPIT_SMTP_SECURE: "false",
          MAILPIT_FROM_EMAIL: "sales@shilabs.local",
          MAILPIT_HTTP_URL: settings.MAILPIT_HTTP_URL ?? "http://localhost:8025",
          AI_PROVIDER: "openai",
          OPENAI_API_KEY: "test-only-browser-adapter",
          OPENAI_MODEL: "test-adapter",
          OPENAI_EMBEDDING_MODEL: "test-adapter-embedding",
          CALENDAR_PROVIDER: "google",
          GOOGLE_CALENDAR_CLIENT_ID: "test-adapter",
          GOOGLE_CALENDAR_CLIENT_SECRET: "test-adapter",
          GOOGLE_CALENDAR_REFRESH_TOKEN: "test-adapter",
          GOOGLE_CALENDAR_ID: "test-adapter-calendar",
          GOOGLE_CALENDAR_SCOPE:
            "https://www.googleapis.com/auth/calendar.freebusy https://www.googleapis.com/auth/calendar.events",
          MESSAGING_PROVIDER: "none",
          WHATSAPP_TEMPLATE_POLICY_MODE: "unresolved",
          VOICE_PROVIDER: "none",
          CONFERENCE_PROVIDER: "none",
          E2E_INBOUND_EMAIL_WEBHOOK_SECRET: "test-only-browser-inbound-secret",
          AWS_SES_WEBHOOK_SECRET: "test-only-browser-inbound-secret",
          REALTIME_INTERNAL_SECRET: "test-only-browser-realtime-secret",
          DOMAIN_EVENT_QUEUE_NAME: `browser-acceptance-${String(Date.now())}-${String(process.pid)}`,
          DOMAIN_EVENT_DISPATCH_INTERVAL_MS: "500",
          DOMAIN_EVENT_WORKER_CONCURRENCY: "2",
          FOLLOW_UP_CADENCE_MODE: "e2e_accelerated_minutes",
          FOLLOW_UP_E2E_CADENCE_MINUTES: "0,1,3,5",
          API_GLOBAL_RATE_LIMIT_MAX: "100000",
          VITE_APP_ENV: "e2e-local"
        };
        for (const [key, value] of Object.entries(overrides)) vi.stubEnv(key, value);
        expect(localHosts.has(new URL(overrides.MAILPIT_HTTP_URL).hostname)).toBe(true);
        expect(localHosts.has(overrides.MAILPIT_SMTP_HOST)).toBe(true);
        const networkAttempts: string[] = [];
        const realFetch = globalThis.fetch;
        vi.stubGlobal("fetch", ((input: RequestInfo | URL, init?: RequestInit) => {
          const url = new URL(
            typeof input === "string" ? input : input instanceof URL ? input : input.url
          );
          if (!localHosts.has(url.hostname)) {
            networkAttempts.push(url.origin);
            return Promise.reject(
              new Error(`External HTTP blocked in browser acceptance: ${url.origin}`)
            );
          }
          return realFetch(input, init);
        }) satisfies typeof fetch);

        let api: Server | undefined;
        let closeRealtime: (() => Promise<void>) | undefined;
        let worker: { close: () => Promise<void> } | undefined;
        let vite: ChildProcess | undefined;
        const children = new Set<ChildProcess>();
        const results: { step: number; screenshots: string[]; mode?: string }[] = [];
        try {
          const { createApp } = await import("../app.js");
          const { prisma } = await import("../shared/prisma.js");
          const schemaRows = await prisma.$queryRaw<
            { current_schema: string }[]
          >`SELECT current_schema()`;
          expect(schemaRows[0]?.current_schema).toBe(schema);
          const { hashPassword } = await import("../modules/auth/auth.service.js");
          const workspace = await prisma.workspace.findUniqueOrThrow({
            where: { slug: "default" }
          });
          const adminData = {
            passwordHash: await hashPassword("ChangeMe123!"),
            firstName: "Development",
            lastName: "Admin",
            role: "ADMIN" as const,
            status: "ACTIVE" as const
          };
          const admin = await prisma.user.upsert({
            where: { email: "admin@example.local" },
            create: { email: "admin@example.local", ...adminData },
            update: adminData
          });
          await prisma.workspaceMember.upsert({
            where: { workspaceId_userId: { workspaceId: workspace.id, userId: admin.id } },
            create: {
              workspaceId: workspace.id,
              userId: admin.id,
              role: "ADMIN",
              status: "ACTIVE"
            },
            update: { role: "ADMIN", status: "ACTIVE" }
          });
          api = createApp().listen(0, "127.0.0.1");
          await once(api, "listening");
          const { installRealtimeWebSocketServer } =
            await import("../modules/realtime/realtime.service.js");
          closeRealtime = installRealtimeWebSocketServer(api);
          const address = api.address();
          if (!address || typeof address === "string") throw new Error("No API address");
          const apiUrl = `http://127.0.0.1:${String(address.port)}`;
          vi.stubEnv("API_BASE_URL", apiUrl);
          vi.stubEnv("WORKER_API_BASE_URL", apiUrl);
          vi.stubEnv("REALTIME_INTERNAL_URL", apiUrl);
          const runtimePath = pathToFileURL(path.join(root, "apps/worker/src/runtime.ts")).href;
          const runtime = (await import(/* @vite-ignore */ runtimePath)) as {
            startWorkerRuntime: () => Promise<{ close: () => Promise<void> }>;
          };
          worker = await runtime.startWorkerRuntime();
          const login = await fetch(`${apiUrl}/api/auth/login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: "admin@example.local", password: "ChangeMe123!" })
          });
          expect(login.status).toBe(200);
          const auth = (await login.json()) as AuthResponse;
          const knowledge = await fetch(`${apiUrl}/api/knowledge-base`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${auth.accessToken}`
            },
            body: JSON.stringify({
              key: `browser-commercial-guardrails-${String(Date.now())}`,
              title: "Browser acceptance commercial guardrails",
              category: "GENERAL",
              content:
                "CRM discovery covers migration and integration planning. Pricing, discounts, legal terms and delivery commitments require written human approval. No discount is approved.",
              sourceTitle: "Local acceptance fixture",
              sourceType: "TEST_ADAPTER",
              approve: true
            })
          });
          expect(knowledge.status).toBe(201);
          const workflow = await fetch(`${apiUrl}/api/workflows`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${auth.accessToken}`
            },
            body: JSON.stringify({
              name: "Priority lead follow-up",
              description: "Isolated browser acceptance workflow"
            })
          });
          expect(workflow.status).toBe(201);

          const childEnv = {
            ...process.env,
            VITE_API_BASE_URL: apiUrl,
            LIVE_FLOW_API_URL: apiUrl,
            LIVE_FLOW_WEB_URL: webUrl,
            LIVE_FLOW_OUTPUT_DIR: outputDir,
            LIVE_FLOW_ADMIN_EMAIL: "admin@example.local",
            LIVE_FLOW_ADMIN_PASSWORD: "ChangeMe123!",
            PLAYWRIGHT_MODULE: require.resolve("@playwright/test")
          };
          vite = spawn(
            process.execPath,
            [
              path.join(root, "node_modules/vite/bin/vite.js"),
              "--host",
              "127.0.0.1",
              "--port",
              String(webPort),
              "--strictPort"
            ],
            {
              cwd: path.join(root, "apps/web"),
              env: childEnv,
              windowsHide: true,
              stdio: ["ignore", "pipe", "pipe"]
            }
          );
          let viteErrors = "";
          vite.stderr?.on("data", (data: Buffer) => {
            viteErrors += data.toString();
          });
          vite.stdout?.resume();
          await waitForUrl(webUrl, vite).catch((error: unknown) => {
            throw new Error(`${String(error)} ${viteErrors}`);
          });
          for (let step = 1; step <= 22; step += 1) {
            const script =
              step === 22
                ? path.join(root, "apps/api/src/acceptance/local-integration-step.cjs")
                : path.join(root, "scripts/live-manager-flow.cjs");
            const child = spawn(process.execPath, [script], {
              cwd: root,
              env: { ...childEnv, LIVE_FLOW_STEP: String(step) },
              windowsHide: true,
              stdio: ["ignore", "pipe", "pipe"]
            });
            children.add(child);
            let stdout = "";
            let stderr = "";
            child.stdout.on("data", (data: Buffer) => {
              stdout += data.toString();
            });
            child.stderr.on("data", (data: Buffer) => {
              stderr += data.toString();
            });
            const timer = setTimeout(() => {
              void stopChild(child);
            }, 150_000);
            let code: number | null;
            try {
              [code] = (await once(child, "exit")) as [number | null];
            } finally {
              clearTimeout(timer);
              children.delete(child);
            }
            expect(code, `Step ${String(step)}: ${stderr}`).toBe(0);
            const result = JSON.parse(stdout) as {
              step: number;
              screenshot?: string;
              screenshots?: string[] | Record<string, string>;
              mode?: string;
            };
            expect(result.step).toBe(step);
            const screenshots = result.screenshot
              ? [result.screenshot]
              : Array.isArray(result.screenshots)
                ? result.screenshots
                : Object.values(result.screenshots ?? {});
            expect(
              screenshots.length,
              `Step ${String(step)} returned no screenshot`
            ).toBeGreaterThan(0);
            for (const screenshot of screenshots) {
              expect(path.dirname(screenshot)).toBe(outputDir);
              const png = await readFile(screenshot);
              expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
              expect(png.length).toBeGreaterThan(10_000);
            }
            results.push({
              step: result.step,
              screenshots,
              ...(result.mode ? { mode: result.mode } : {})
            });
            console.info("Browser step passed", {
              step,
              mode: "TEST_ADAPTERS",
              screenshots
            });
          }
          expect(aiCalls).toContain("extractQualification");
          expect(aiCalls).toContain("understandReply");
          expect(aiCalls).toContain("generateProposalDraft");
          expect(calendarCalls).toContain("getAvailability");
          expect(calendarCalls).toContain("createMeeting");
          expect(networkAttempts).toEqual([]);
          expect(results).toHaveLength(22);
          console.info("Persisted browser acceptance complete", {
            ...adapterMetadata,
            steps: results.length,
            screenshots: (await readdir(outputDir)).filter((file) => file.endsWith(".png")).length,
            outputDir
          });
        } finally {
          for (const child of children) await stopChild(child);
          if (vite) await stopChild(vite);
          if (worker) await worker.close();
          if (closeRealtime) await closeRealtime();
          if (api) {
            api.closeAllConnections();
            const server = api;
            await new Promise<void>((resolve, reject) =>
              server.close((error) => (error ? reject(error) : resolve()))
            );
          }
          const { prisma } = await import("../shared/prisma.js");
          await prisma.$disconnect();
          vi.unstubAllGlobals();
          vi.unstubAllEnvs();
        }
      },
      30 * 60_000
    );
  }
);
