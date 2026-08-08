import type { RequestHandler } from "express";
import { HttpError } from "./http-error.js";
import { currentUserId } from "./user-context.js";

interface Bucket {
  count: number;
  resetAt: number;
}

/**
 * Per-route in-memory rate limit, keyed by the AUTHENTICATED USER ID rather than
 * the client IP. Every router this mounts on sits behind requireAuth, so the
 * user is always bound in the async context by the time the limiter runs; we
 * fall back to req.ip only in the defensive case of no user context (e.g. a
 * misordered mount). Keying by user prevents one user's burst from throttling
 * everyone behind a shared NAT/proxy, and stops a single user from evading the
 * limit by rotating source IPs.
 *
 * DEPLOY NOTE: this store is in-process, so it is per-instance. A real
 * multi-instance / autoscaled deployment MUST swap this Map for a shared store
 * (Redis, Upstash, or Postgres) keyed the same way, or each instance enforces
 * only its own slice of the limit. Single-instance dev/staging is fine as-is.
 */
export function rateLimit(opts: { windowMs: number; max: number }): RequestHandler {
  const buckets = new Map<string, Bucket>();
  return (req, res, next) => {
    let key: string;
    try {
      key = `u:${currentUserId()}`;
    } catch {
      key = `ip:${req.ip ?? "unknown"}`;
    }
    const now = Date.now();
    const bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + opts.windowMs });
      next();
      return;
    }
    bucket.count += 1;
    if (bucket.count > opts.max) {
      // Standard Retry-After (seconds until the bucket resets) so a caller can
      // show a real countdown instead of a generic "try again later" — see
      // apps/web/src/lib/sse.ts's onopen, which reads this header on a 429.
      res.setHeader("Retry-After", String(Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))));
      next(new HttpError(429, "Too many requests — slow down."));
      return;
    }
    next();
  };
}

/**
 * Per-IP in-memory rate limit for PRE-AUTH endpoints (there is no user id yet),
 * keyed strictly by client IP — deliberately SEPARATE from the per-user
 * rateLimit() above so a burst of anonymous-session creation from one IP can't
 * consume anyone else's per-user budget, and vice versa.
 *
 * Reading a correct client IP behind Cloudflare/Render requires `trust proxy`
 * (set in index.ts for production); without it req.ip is the proxy's socket IP.
 * A spoofed X-Forwarded-For could rotate the key, but the AUTHORITATIVE per-IP
 * cap on anonymous sign-ins is Supabase's own GoTrue `anonymous_users` rate
 * limit (config.toml / dashboard), which sees the true client IP and cannot be
 * bypassed — this app-level gate is the graceful, tunable, in-repo layer in
 * front of it (a friendly "create an account" nudge before GoTrue's opaque 429),
 * NOT the last line of defense. Same per-instance caveat as rateLimit() applies.
 */
export function rateLimitByIp(opts: { windowMs: number; max: number; message?: string }): RequestHandler {
  const buckets = new Map<string, Bucket>();
  return (req, _res, next) => {
    const key = `ip:${req.ip ?? "unknown"}`;
    const now = Date.now();
    const bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + opts.windowMs });
      next();
      return;
    }
    bucket.count += 1;
    if (bucket.count > opts.max) {
      next(new HttpError(429, opts.message ?? "Too many requests — slow down."));
      return;
    }
    next();
  };
}
