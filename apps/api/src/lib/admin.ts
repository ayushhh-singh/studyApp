/**
 * Admin gate for the Review Queue. Backed by the `is_admin` flag on
 * users_profile (migration 0054), which replaced the old ADMIN_MODE env flag.
 * The check is per authenticated user: requireAdmin looks up is_admin for the
 * token-derived currentUserId(). The frontend learns the current user's admin
 * status from GET /admin/status and hides the queue when false.
 */
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { HttpError } from "./http-error.js";
import { supabase } from "./supabase.js";
import { currentUserId } from "./user-context.js";

/** True when the authenticated user's profile has is_admin = true. */
export async function isCurrentUserAdmin(): Promise<boolean> {
  const { data, error } = await supabase()
    .from("users_profile")
    .select("is_admin")
    .eq("id", currentUserId())
    .maybeSingle();
  if (error) throw new Error(`admin lookup failed: ${error.message}`);
  return data?.is_admin === true;
}

/** 403s every /admin/review/* + /admin/notes/* route unless the user is an admin. */
export const requireAdmin: RequestHandler = (_req: Request, _res: Response, next: NextFunction) => {
  isCurrentUserAdmin()
    .then((ok) => {
      if (!ok) {
        next(new HttpError(403, "Admin access required."));
        return;
      }
      next();
    })
    .catch(next);
};
