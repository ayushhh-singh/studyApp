import type { ErrorRequestHandler, RequestHandler } from "express";
import { logger } from "../lib/logger.js";
import { HttpError } from "../lib/http-error.js";

export const notFoundHandler: RequestHandler = (req, res) => {
  res.status(404).json({ data: null, error: `No route for ${req.method} ${req.path}` });
};

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  const status = err instanceof HttpError ? err.status : 500;
  const message = err instanceof Error ? err.message : "Internal server error";
  if (status >= 500) logger.error({ err }, "unhandled error");
  const feature = err instanceof HttpError ? err.feature : undefined;
  res.status(status).json({ data: null, error: message, ...(feature ? { feature } : {}) });
};
