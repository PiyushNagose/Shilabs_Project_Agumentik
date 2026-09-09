import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { AppError, isAppError } from "../shared/errors.js";

interface ErrorResponse {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export function notFoundHandler(request: Request, _response: Response, next: NextFunction): void {
  next(new AppError(404, "NOT_FOUND", `Route not found: ${request.method} ${request.path}`));
}

export function errorHandler(
  error: unknown,
  _request: Request,
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
        details: error.issues
      }
    });
    return;
  }

  if (isAppError(error)) {
    response.status(error.statusCode).json({
      error: {
        code: error.code,
        message: error.message,
        details: error.details
      }
    });
    return;
  }

  response.status(500).json({
    error: {
      code: "INTERNAL_ERROR",
      message: "Internal server error"
    }
  });
}
