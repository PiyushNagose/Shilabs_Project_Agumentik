import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

const SAFE_REQUEST_ID = /^[A-Za-z0-9._:-]{8,128}$/;

function requestIdFrom(request: Request): string {
  const candidate = request.header("x-request-id")?.trim();
  return candidate && SAFE_REQUEST_ID.test(candidate) ? candidate : randomUUID();
}

export function requestContext(request: Request, response: Response, next: NextFunction): void {
  const startedAt = process.hrtime.bigint();
  const path = request.originalUrl.split("?", 1)[0] ?? request.path;
  request.requestId = requestIdFrom(request);
  response.setHeader("X-Request-Id", request.requestId);

  response.on("finish", () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    console.log(
      JSON.stringify({
        level: response.statusCode >= 500 ? "error" : "info",
        event: "http_request_completed",
        requestId: request.requestId,
        method: request.method,
        path,
        statusCode: response.statusCode,
        durationMs: Math.round(durationMs * 10) / 10,
        userId: request.user?.id ?? null,
        workspaceId: request.user?.activeWorkspaceId ?? null
      })
    );
  });
  next();
}
