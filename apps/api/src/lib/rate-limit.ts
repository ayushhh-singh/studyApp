import type { RequestHandler } from "express";
import { HttpError } from "./http-error.js";

interface Bucket {
  count: number;
  resetAt: number;
}

/**
 * Per-route in-memory rate limit. Each call site gets its own bucket map, so
 * mount one instance per router. Fine for a single dev-user backend; a real
 * multi-instance deployment would need a shared store instead.
 */
export function rateLimit(opts: { windowMs: number; max: number }): RequestHandler {
  const buckets = new Map<string, Bucket>();
  return (req, _res, next) => {
    const key = req.ip ?? "unknown";
    const now = Date.now();
    const bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + opts.windowMs });
      next();
      return;
    }
    bucket.count += 1;
    if (bucket.count > opts.max) {
      next(new HttpError(429, "Too many requests — slow down."));
      return;
    }
    next();
  };
}
