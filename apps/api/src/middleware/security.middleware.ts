import type { NextFunction, Request, Response } from "express";
import rateLimit from "express-rate-limit";
import type { ApiConfig } from "@shilabs/shared-config";

export function securityHeaders(_request: Request, response: Response, next: NextFunction): void {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  response.setHeader("Cross-Origin-Resource-Policy", "same-site");
  response.setHeader("Cache-Control", "no-store");
  next();
}

export function createGlobalRateLimiter(config: ApiConfig) {
  return rateLimit({
    windowMs: config.globalRateLimitWindowMs,
    limit: config.globalRateLimitMax,
    standardHeaders: true,
    legacyHeaders: false
  });
}

export function createWebhookRateLimiter(config: ApiConfig) {
  return rateLimit({
    windowMs: config.webhookRateLimitWindowMs,
    limit: config.webhookRateLimitMax,
    standardHeaders: true,
    legacyHeaders: false
  });
}
