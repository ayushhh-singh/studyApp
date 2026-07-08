/**
 * Per-request authenticated-user context.
 *
 * The auth middleware (middleware/require-auth.ts) verifies the Supabase JWT,
 * derives the user id from its `sub` claim, and runs the rest of the request
 * inside an AsyncLocalStorage store. Every user-scoped service reads the id via
 * `currentUserId()` — the same choke point the pre-auth `devUserId()` was, but
 * now sourced from the caller's token instead of an env var.
 *
 * Background jobs (schedulers, CLIs) have no request, so they call
 * `runWithUser(id, fn)` explicitly (see daily/scheduler.ts, mastery/cli.ts).
 */
import { AsyncLocalStorage } from "node:async_hooks";

interface UserStore {
  userId: string;
}

const storage = new AsyncLocalStorage<UserStore>();

/** Run `fn` with `userId` bound as the current user for its whole async subtree. */
export function runWithUser<T>(userId: string, fn: () => T): T {
  return storage.run({ userId }, fn);
}

/**
 * The authenticated user id for the current request/job context. Throws if
 * called outside one — a programming error (a handler reached without the auth
 * middleware, or a job that forgot to wrap itself in runWithUser).
 */
export function currentUserId(): string {
  const store = storage.getStore();
  if (!store) {
    throw new Error(
      "currentUserId() called outside an authenticated context — missing requireAuth middleware or runWithUser wrapper",
    );
  }
  return store.userId;
}
