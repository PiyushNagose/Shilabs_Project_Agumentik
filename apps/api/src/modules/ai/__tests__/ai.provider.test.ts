import { afterEach, describe, expect, it, vi } from "vitest";
import { getAIConfig } from "../../../config/ai.js";
import { GeminiProvider } from "../../integrations/gemini/gemini.provider.js";
import { OpenAIProvider } from "../../integrations/openai/openai.provider.js";
import { createAIProvider } from "../ai.factory.js";
import type { AIProvider, BriefingResult, SalesReplyInput } from "../ai.provider.js";
import { MockAIProvider } from "./mock-ai.provider.js";

const env = {
  AI_PROVIDER: "openai",
  OPENAI_API_KEY: "test-secret-only",
  OPENAI_MODEL: "test-model",
  OPENAI_EMBEDDING_MODEL: "test-embedding",
  AI_MAX_RETRIES: "0"
};
const geminiEnv = {
  AI_PROVIDER: "gemini",
  GEMINI_API_KEY: "test-gemini-secret-only",
  GEMINI_MODEL: "test-gemini-model",
  GEMINI_EMBEDDING_MODEL: "test-gemini-embedding",
  AI_MAX_RETRIES: "0"
};
const input: SalesReplyInput = {
  messages: [{ id: "m1", senderType: "PROSPECT", body: "We need a website" }],
  leadContext: "",
  approvedKnowledge: []
};
const reply = {
  body: "What should the website support?",
  requiresHumanReview: false,
  reason: null
};
const qualification = {
  need: "website",
  requirement: null,
  budget: null,
  budgetBand: null,
  authority: null,
  timeline: null,
  businessFit: null,
  decisionMakerIdentified: null,
  urgency: null,
  evidence: [{ messageId: "m1", quote: "need a website" }]
};
const summary = {
  summary: "Website requested",
  buyingSignals: [],
  objections: [],
  risks: [],
  suggestedNextAction: null
};
const replyUnderstanding = {
  intent: "INTERESTED" as const,
  confidence: 0.9,
  summary: "Prospect is interested",
  draftResponse: "Thanks for your interest.",
  requiresHumanReview: true,
  recommendedAction: "DRAFT_RESPONSE" as const,
  evidence: [{ messageId: "m1", quote: "need a website" }],
  usedKnowledgeIds: []
};
const briefing: BriefingResult = {
  summary: "Website briefing",
  requirements: "We need a website",
  budget: null,
  timeline: null,
  decisionContext: null,
  recentCommunication: "Prospect said they need a website",
  qualification: null,
  proposalDealContext: null,
  meetingContext: null,
  recommendedNextAction: "Ask for requirements",
  usedKnowledgeIds: [],
  evidence: [{ sourceId: "m1", quote: "need a website" }],
  requiresHumanReview: true,
  unknowns: ["budget", "timeline"]
};
function completion(value: unknown, finish = "stop") {
  return Response.json({
    choices: [{ finish_reason: finish, message: { content: JSON.stringify(value) } }]
  });
}
function geminiCompletion(value: unknown, finish = "STOP") {
  return Response.json({
    candidates: [
      {
        finishReason: finish,
        content: { parts: [{ text: JSON.stringify(value) }] }
      }
    ]
  });
}
function setup() {
  const transport = vi.fn<typeof fetch>();
  const config = getAIConfig(env);
  if (config.AI_PROVIDER !== "openai") throw new Error("Unexpected OpenAI test config");
  const provider = new OpenAIProvider(config, transport);
  return { provider, transport };
}
function setupGemini() {
  const transport = vi.fn<typeof fetch>();
  const config = getAIConfig(geminiEnv);
  if (config.AI_PROVIDER !== "gemini") throw new Error("Unexpected Gemini test config");
  const provider = new GeminiProvider(config, transport);
  return { provider, transport };
}
afterEach(() => {
  vi.restoreAllMocks();
});

describe("M9 AI provider", () => {
  it("supports all provider methods behind a replaceable interface", async () => {
    const { provider, transport } = setup();
    transport
      .mockResolvedValueOnce(completion(reply))
      .mockResolvedValueOnce(completion(qualification))
      .mockResolvedValueOnce(completion(summary))
      .mockResolvedValueOnce(completion(reply))
      .mockResolvedValueOnce(completion(replyUnderstanding))
      .mockResolvedValueOnce(completion(briefing))
      .mockResolvedValueOnce(Response.json({ data: [{ index: 0, embedding: [0.1, -0.2] }] }));
    const real: AIProvider = provider;
    const results = [
      await real.generateSalesReply(input),
      await real.extractQualification(input),
      await real.summarizeLead(input),
      await real.generateFollowUp(input),
      await real.understandReply(input),
      await real.generateBriefing(input),
      await real.createEmbedding("website")
    ];
    const mock: AIProvider = new MockAIProvider({
      generateSalesReply: () => Promise.resolve(reply),
      extractQualification: () => Promise.resolve(qualification),
      summarizeLead: () => Promise.resolve(summary),
      generateFollowUp: () => Promise.resolve(reply),
      generateProposalDraft: () =>
        Promise.resolve({
          title: "Proposal",
          serviceType: "AI Sales",
          content: "Proposal content",
          usedKnowledgeIds: [],
          evidence: [],
          requiresHumanReview: true,
          missingInformation: []
        }),
      understandReply: () => Promise.resolve(replyUnderstanding),
      generateBriefing: () => Promise.resolve(briefing),
      createEmbedding: () => Promise.resolve([0.1, -0.2])
    });
    expect(results).toEqual([
      await mock.generateSalesReply(input),
      await mock.extractQualification(input),
      await mock.summarizeLead(input),
      await mock.generateFollowUp(input),
      await mock.understandReply(input),
      await mock.generateBriefing(input),
      await mock.createEmbedding("website")
    ]);
    expect(transport.mock.calls[0]?.[1]?.body).toContain('"strict":true');
    expect(transport.mock.calls[0]?.[1]?.body).toContain('"store":false');
  });

  it.each([{}, { ...reply, score: 100 }, { ...reply, body: "" }])(
    "rejects malformed or authoritative output %j",
    async (value) => {
      const { provider, transport } = setup();
      transport.mockResolvedValue(completion(value));
      await expect(provider.generateSalesReply(input)).rejects.toMatchObject({
        code: "PROVIDER_ERROR"
      });
      expect(transport).toHaveBeenCalledTimes(1);
    }
  );
  it("rejects fabricated evidence", async () => {
    const { provider, transport } = setup();
    transport.mockResolvedValue(
      completion({ ...qualification, evidence: [{ messageId: "m1", quote: "budget 50000" }] })
    );
    await expect(provider.extractQualification(input)).rejects.toMatchObject({
      code: "PROVIDER_ERROR"
    });
  });
  it.each(["length", "content_filter"])(
    "rejects incomplete/refused completion %s",
    async (finish) => {
      const { provider, transport } = setup();
      transport.mockResolvedValue(completion(reply, finish));
      await expect(provider.generateSalesReply(input)).rejects.toMatchObject({
        code: "PROVIDER_ERROR"
      });
    }
  );
  it("rejects refusal and non-JSON output", async () => {
    const { provider, transport } = setup();
    transport
      .mockResolvedValueOnce(
        Response.json({
          choices: [{ finish_reason: "stop", message: { content: null, refusal: "refused" } }]
        })
      )
      .mockResolvedValueOnce(
        Response.json({ choices: [{ finish_reason: "stop", message: { content: "not JSON" } }] })
      );
    await expect(provider.generateSalesReply(input)).rejects.toMatchObject({
      code: "PROVIDER_ERROR"
    });
    await expect(provider.generateSalesReply(input)).rejects.toMatchObject({
      code: "PROVIDER_ERROR"
    });
  });
  it("rejects invalid input before transport", async () => {
    const { provider, transport } = setup();
    await expect(provider.createEmbedding(" ")).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(
      provider.generateSalesReply({ ...input, leadContext: "x".repeat(20001) })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(transport).not.toHaveBeenCalled();
  });
  it("rejects invalid embedding vectors", async () => {
    const { provider, transport } = setup();
    transport.mockResolvedValue(Response.json({ data: [{ index: 0, embedding: [] }] }));
    await expect(provider.createEmbedding("text")).rejects.toMatchObject({
      code: "PROVIDER_ERROR"
    });
  });
  it("normalizes provider failures without exposing body or secrets", async () => {
    const log = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { provider, transport } = setup();
    transport.mockResolvedValue(new Response("test-secret-only", { status: 401 }));
    await expect(provider.generateSalesReply(input)).rejects.toMatchObject({
      code: "PROVIDER_ERROR",
      message: "AI provider returned an unusable response"
    });
    expect(JSON.stringify(log.mock.calls)).not.toContain(env.OPENAI_API_KEY);
  });
  it("retries transient failures within the configured bound", async () => {
    const transport = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(completion(reply));
    const config = getAIConfig({ ...env, AI_MAX_RETRIES: "1" });
    if (config.AI_PROVIDER !== "openai") throw new Error("Unexpected OpenAI test config");
    const provider = new OpenAIProvider(config, transport);
    expect(await provider.generateSalesReply(input)).toEqual(reply);
    expect(transport).toHaveBeenCalledTimes(2);
  });
  it("exhausts retries and surfaces retryable error", async () => {
    const transport = vi
      .fn<typeof fetch>()
      .mockImplementation(() => Promise.resolve(new Response(null, { status: 429 })));
    const config = getAIConfig({ ...env, AI_MAX_RETRIES: "1" });
    if (config.AI_PROVIDER !== "openai") throw new Error("Unexpected OpenAI test config");
    const provider = new OpenAIProvider(config, transport);
    await expect(provider.generateSalesReply(input)).rejects.toMatchObject({
      code: "RETRYABLE_PROVIDER_ERROR"
    });
    expect(transport).toHaveBeenCalledTimes(2);
  });
  it("retries timed-out requests and normalizes exhausted timeout", async () => {
    const transport = vi.fn<typeof fetch>().mockImplementation(
      (_url, options) =>
        new Promise((_resolve, reject) => {
          options?.signal?.addEventListener(
            "abort",
            () => reject(new Error("sensitive network detail")),
            { once: true }
          );
        })
    );
    const config = getAIConfig({ ...env, AI_TIMEOUT_MS: "100", AI_MAX_RETRIES: "1" });
    if (config.AI_PROVIDER !== "openai") throw new Error("Unexpected OpenAI test config");
    const provider = new OpenAIProvider(config, transport);
    await expect(provider.generateSalesReply(input)).rejects.toMatchObject({
      code: "RETRYABLE_PROVIDER_ERROR"
    });
    expect(transport).toHaveBeenCalledTimes(2);
  });
  it("normalizes connection errors", async () => {
    const { provider, transport } = setup();
    transport.mockRejectedValue(new TypeError("network secret"));
    await expect(provider.createEmbedding("text")).rejects.toMatchObject({
      code: "RETRYABLE_PROVIDER_ERROR"
    });
  });
  it("creates only the real runtime provider", () => {
    expect(createAIProvider(env)).toBeInstanceOf(OpenAIProvider);
    expect(createAIProvider(geminiEnv)).toBeInstanceOf(GeminiProvider);
    expect(() => createAIProvider({ ...env, AI_PROVIDER: "mock" })).toThrow("AI_PROVIDER");
  });
  it.each([
    { OPENAI_API_KEY: "" },
    { OPENAI_MODEL: "" },
    { AI_TIMEOUT_MS: "NaN" },
    { AI_MAX_RETRIES: "3" }
  ])("validates configuration %j", (overrides) => {
    expect(() => getAIConfig({ ...env, ...overrides })).toThrow("Invalid AI configuration");
    try {
      getAIConfig({ ...env, ...overrides });
    } catch (error) {
      expect(String(error)).not.toContain(env.OPENAI_API_KEY);
    }
  });
});

describe("Gemini AI provider", () => {
  it("supports the AIProvider contract with Gemini REST responses", async () => {
    const { provider, transport } = setupGemini();
    transport
      .mockResolvedValueOnce(geminiCompletion(reply))
      .mockResolvedValueOnce(geminiCompletion(qualification))
      .mockResolvedValueOnce(geminiCompletion(summary))
      .mockResolvedValueOnce(geminiCompletion(reply))
      .mockResolvedValueOnce(geminiCompletion(briefing))
      .mockResolvedValueOnce(Response.json({ embedding: { values: [0.1, -0.2] } }));
    const real: AIProvider = provider;
    expect(await real.generateSalesReply(input)).toEqual(reply);
    expect(await real.extractQualification(input)).toEqual(qualification);
    expect(await real.summarizeLead(input)).toEqual(summary);
    expect(await real.generateFollowUp(input)).toEqual(reply);
    expect(await real.generateBriefing(input)).toEqual(briefing);
    expect(await real.createEmbedding("website")).toEqual([0.1, -0.2]);
    const rawBody = transport.mock.calls[0]?.[1]?.body;
    expect(typeof rawBody).toBe("string");
    const body = rawBody;
    expect(body).toContain('"responseMimeType":"application/json"');
    expect(body).toContain('"responseSchema"');
    expect(body).not.toContain("additionalProperties");
  });

  it("rejects invalid Gemini outputs and fabricated evidence", async () => {
    const { provider, transport } = setupGemini();
    transport
      .mockResolvedValueOnce(geminiCompletion({ ...reply, score: 100 }))
      .mockResolvedValueOnce(
        geminiCompletion({ ...qualification, evidence: [{ messageId: "m1", quote: "budget" }] })
      );
    await expect(provider.generateSalesReply(input)).rejects.toMatchObject({
      code: "PROVIDER_ERROR"
    });
    await expect(provider.extractQualification(input)).rejects.toMatchObject({
      code: "PROVIDER_ERROR"
    });
  });

  it("normalizes Gemini failures without exposing body or secrets", async () => {
    const log = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { provider, transport } = setupGemini();
    transport.mockResolvedValue(new Response("test-gemini-secret-only", { status: 403 }));
    await expect(provider.generateSalesReply(input)).rejects.toMatchObject({
      code: "PROVIDER_ERROR",
      message: "AI provider returned an unusable response"
    });
    expect(JSON.stringify(log.mock.calls)).not.toContain(geminiEnv.GEMINI_API_KEY);
  });

  it("retries transient Gemini failures within the configured bound", async () => {
    const transport = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(geminiCompletion(reply));
    const config = getAIConfig({ ...geminiEnv, AI_MAX_RETRIES: "1" });
    if (config.AI_PROVIDER !== "gemini") throw new Error("Unexpected Gemini test config");
    const provider = new GeminiProvider(config, transport);
    expect(await provider.generateSalesReply(input)).toEqual(reply);
    expect(transport).toHaveBeenCalledTimes(2);
  });

  it("retries timed-out Gemini requests within the configured bound", async () => {
    const transport = vi.fn<typeof fetch>().mockImplementation(
      (_url, options) =>
        new Promise((_resolve, reject) => {
          options?.signal?.addEventListener(
            "abort",
            () => reject(new Error("sensitive network detail")),
            { once: true }
          );
        })
    );
    const config = getAIConfig({ ...geminiEnv, AI_TIMEOUT_MS: "100", AI_MAX_RETRIES: "1" });
    if (config.AI_PROVIDER !== "gemini") throw new Error("Unexpected Gemini test config");
    const provider = new GeminiProvider(config, transport);
    await expect(provider.generateSalesReply(input)).rejects.toMatchObject({
      code: "RETRYABLE_PROVIDER_ERROR",
      message: "AI provider temporarily unavailable"
    });
    expect(transport).toHaveBeenCalledTimes(2);
  });
});
