import type { NextFunction, Request, RequestHandler, Response } from "express";
import { verifyAccessToken, AuthError } from "../lib/jwt.js";
import { runWithUser } from "../lib/user-context.js";
import { HttpError } from "../lib/http-error.js";

function extractBearer(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header) return null;
  const [scheme, token] = header.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) return null;
  return token.trim();
}

/**
 * Verifies the Supabase JWT on every protected request, derives the user id
 * from it, and runs the rest of the request inside an AsyncLocalStorage context
 * (see lib/user-context.ts) so downstream handlers read it via currentUserId().
 *
 * Mounted once in index.ts after the public health route — everything below it
 * is authenticated. SSE endpoints are covered too: the web client sends the
 * bearer token via @microsoft/fetch-event-source headers.
 */
export const requireAuth: RequestHandler = (req: Request, res: Response, next: NextFunction) => {
  const token = extractBearer(req);
  if (!token) {
    next(new HttpError(401, "Missing or malformed Authorization header"));
    return;
  }
  verifyAccessToken(token)
    .then((userId) => {
      runWithUser(userId, () => next());
    })
    .catch((err) => {
      if (err instanceof AuthError) {
        next(new HttpError(401, "Invalid or expired session"));
      } else {
        next(err);
      }
    });
};
