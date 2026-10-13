import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { emitOperationalAlert } from "@shilabs/shared-config";
import { AppError, isAppError } from "../shared/errors.js";
import { redactSecrets } from "../shared/redaction.js";

interface ErrorResponse {
  error: {
    code: string;
    message: string;
    details?: unknown;
    requestId?: string;
  };
}

export function notFoundHandler(request: Request, _response: Response, next: NextFunction): void {
  next(new AppError(404, "NOT_FOUND", `Route not found: ${request.method} ${request.path}`));
}

export function errorHandler(
  error: unknown,
  request: Request,
  response: Response<ErrorResponse>,
  // Express identifies error middleware by arity, so this argument must remain present.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  next: NextFunction
): void {
  if (error instanceof ZodError) {
    response.status(400).json({
      error: {
        code: "VALIDATION_ERROR",
        message: "Request validation failed",
        details: redactSecrets(error.issues),
        requestId: request.requestId
      }
    });
    return;
  }

  if (isAppError(error)) {
    response.status(error.statusCode).json({
      error: {
        code: error.code,
        message: redactSecrets(error.message),
        details: error.details === undefined ? undefined : redactSecrets(error.details),
        requestId: request.requestId
      }
    });
    return;
  }

  if (error && typeof error === "object" && "type" in error && error.type === "entity.too.large") {
    response.status(413).json({
      error: {
        code: "VALIDATION_ERROR",
        message: "Request body is too large",
        requestId: request.requestId
      }
    });
    return;
  }

  console.error(
    JSON.stringify({
      level: "error",
      event: "unhandled_request_error",
      requestId: request.requestId,
      method: request.method,
      path: request.path,
      error: redactSecrets(error instanceof Error ? error.message : "Unknown error")
    })
  );
  void emitOperationalAlert({
    category: "api_failure",
    severity: "error",
    message: error instanceof Error ? error.message : "Unknown request failure",
    correlationId: request.requestId,
    metadata: { method: request.method, path: request.path, statusCode: 500 }
  });
  response.status(500).json({
    error: {
      code: "INTERNAL_ERROR",
      message: "Internal server error",
      requestId: request.requestId
    }
  });
}
