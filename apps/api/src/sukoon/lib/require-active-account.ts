/**
 * Access-revocation guard for a soft-deleted (scheduled-for-deletion) Sukoon
 * account (F12). Applied router-wide to the active-feature routers AFTER
 * requireAuth: once a user asks to delete their account (or withdraws consent),
 * they are IMMEDIATELY blocked from creating/mutating data or spending model
 * budget, even though the rows survive the 7-day grace window for restore.
 *
 * Deliberately NOT applied to the profile, billing, or privacy routers — a
 * deactivated user must still be able to read their state and RESTORE or EXPORT
 * during the grace period. Returns a machine `feature` code the client branches
 * on to show the "scheduled for deletion" banner instead of a generic error.
 *
 * Only MUTATIONS are blocked (non-GET/HEAD): the whole point of revocation is to
 * stop new data creation and model spend, both of which are POST/PATCH/DELETE
 * across every guarded router. Reads stay open so the app's own cards still
 * render during the grace window (no 403 noise) and the user can review — or
 * export — the data that's about to be erased. An extra DB round-trip per write
 * is a cheap PK lookup and only fires on mutations, not on hot read paths.
 */
import type { RequestHandler } from "express";
import { HttpError } from "../../lib/http-error.js";
import { currentUserId } from "../../lib/user-context.js";
import { isSukoonAccountDeleted } from "../services/privacy.js";

export const requireActiveSukoonAccount: RequestHandler = (req, _res, next) => {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") {
    next();
    return;
  }
  isSukoonAccountDeleted(currentUserId())
    .then((deleted) => {
      if (deleted) {
        next(
          new HttpError(403, "This Sukoon account is scheduled for deletion.", {
            feature: "sukoon_account_deleted",
          }),
        );
        return;
      }
      next();
    })
    .catch(next);
};
