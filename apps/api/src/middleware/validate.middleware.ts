import type { NextFunction, Request, Response } from "express";
import type { ZodType } from "zod";

export function validateBody(schema: ZodType) {
  return (request: Request, _response: Response, next: NextFunction): void => {
    const result = schema.parse(request.body);
    request.body = result;
    next();
  };
}

export function validateQuery(schema: ZodType) {
  return (request: Request, _response: Response, next: NextFunction): void => {
    const result = schema.parse(request.query);
    request.validatedQuery = result;
    next();
  };
}
