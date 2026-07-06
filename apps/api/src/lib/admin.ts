/**
 * Admin gate for the Review Queue. Enabled by the env flag ADMIN_MODE=true
 * (a stopgap until it becomes an is_admin profile flag in Session 18b). The
 * flag is read fresh per call so a dev can toggle it without a code change; the
 * frontend learns the value from GET /admin/status and hides the queue when off.
 */
import type { RequestHandler } from "express";
import { HttpError } from "./http-error.js";

export function isAdminMode(): boolean {
  return process.env.ADMIN_MODE === "true";
}

/** 403s every /admin/review/* mutation + read when ADMIN_MODE is not enabled. */
export const requireAdmin: RequestHandler = (_req, _res, next) => {
  if (!isAdminMode()) {
    throw new HttpError(403, "Admin mode is not enabled (set ADMIN_MODE=true in apps/api/.env).");
  }
  next();
};
