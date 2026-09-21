import { getAIConfig } from "../../config/ai.js";
import { GeminiProvider } from "../integrations/gemini/gemini.provider.js";
import { OpenAIProvider } from "../integrations/openai/openai.provider.js";
import type { AIProvider } from "./ai.provider.js";

export function createAIProvider(env: NodeJS.ProcessEnv = process.env): AIProvider {
  const config = getAIConfig(env);
  if (config.AI_PROVIDER === "gemini") return new GeminiProvider(config);
  return new OpenAIProvider(config);
}
