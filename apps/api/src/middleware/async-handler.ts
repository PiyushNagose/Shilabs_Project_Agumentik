import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { ParamsDictionary } from "express-serve-static-core";
import type { ParsedQs } from "qs";

export function asyncHandler<
  Params extends ParamsDictionary = ParamsDictionary,
  ResponseBody = unknown,
  RequestBody = unknown,
  Query extends ParsedQs = ParsedQs
>(
  handler: (
    request: Request<Params, ResponseBody, RequestBody, Query>,
    response: Response<ResponseBody>,
    next: NextFunction
  ) => Promise<void>
): RequestHandler<Params, ResponseBody, RequestBody, Query> {
  return (request, response, next): void => {
    handler(request, response, next).catch(next);
  };
}
