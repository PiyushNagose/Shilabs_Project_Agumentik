import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import type { SemrushConfig } from "../../../config/semrush.js";
import { AppError } from "../../../shared/errors.js";
import type { SEODataProvider, SEODataResult } from "./seo-data.provider.js";

const domainRankRowSchema = z.object({
  Or: z.coerce.number().nullable().optional(),
  Ot: z.coerce.number().nullable().optional()
});

function providerError(message: string, retryable = false): AppError {
  return new AppError(
    retryable ? 503 : 502,
    retryable ? "RETRYABLE_PROVIDER_ERROR" : "PROVIDER_ERROR",
    message
  );
}

function hostnameFrom(input: string): string {
  try {
    return new URL(input.startsWith("http") ? input : `https://${input}`).hostname;
  } catch {
    throw new AppError(400, "VALIDATION_ERROR", "Invalid SEO target URL");
  }
}

export class SemrushProvider implements SEODataProvider {
  public constructor(
    private readonly config: SemrushConfig,
    private readonly transport: typeof fetch = fetch
  ) {}

  public async analyzeDomain(input: { targetUrl: string }): Promise<SEODataResult> {
    if (this.config.status === "NOT_CONFIGURED") {
      throw new AppError(
        503,
        "PROVIDER_ERROR",
        `SEMrush is not configured: ${this.config.missing.join(", ")}`
      );
    }

    const domain = hostnameFrom(input.targetUrl);
    const params = new URLSearchParams({
      type: "domain_rank",
      key: this.config.apiKey,
      export_columns: "Or,Ot",
      domain,
      database: this.config.database,
      display_limit: "1"
    });
    const raw = await this.request(`${this.config.endpoint}?${params.toString()}`);
    const parsed = domainRankRowSchema.safeParse(Array.isArray(raw) ? raw[0] : raw);
    if (!parsed.success) {
      throw providerError("SEMrush returned an unusable response");
    }
    return {
      provider: "SEMRUSH",
      targetUrl: input.targetUrl,
      database: this.config.database,
      organicKeywords: parsed.data.Or ?? null,
      organicTraffic: parsed.data.Ot ?? null,
      backlinks: null,
      raw
    };
  }

  private async request(url: string): Promise<unknown> {
    const signal = AbortSignal.timeout(this.config.timeoutMs);
    for (let attempt = 0; ; attempt++) {
      try {
        const response = await this.transport(url, { method: "GET", redirect: "error", signal });
        if (!response.ok) {
          await response.body?.cancel();
          throw providerError("SEMrush request failed", response.status === 429 || response.status >= 500);
        }
        const text = await response.text();
        if (text.toLowerCase().startsWith("error")) {
          throw providerError("SEMrush returned an error response");
        }
        const [headerLine, valueLine] = text.trim().split(/\r?\n/);
        const headers = headerLine?.split(";") ?? [];
        const values = valueLine?.split(";") ?? [];
        return [
          Object.fromEntries(headers.map((header, index) => [header, values[index] ?? null]))
        ];
      } catch (error) {
        const normalized = error instanceof AppError ? error : providerError("SEMrush unavailable", true);
        if (
          signal.aborted ||
          normalized.code !== "RETRYABLE_PROVIDER_ERROR" ||
          attempt >= this.config.maxRetries
        ) {
          throw normalized;
        }
        try {
          await delay(500 * 2 ** attempt, undefined, { signal });
        } catch {
          throw providerError("SEMrush unavailable", true);
        }
      }
    }
  }
}
