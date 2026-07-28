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
  /** True iff this request is a Supabase native anonymous (guest) session. */
  isAnonymous: boolean;
}

const storage = new AsyncLocalStorage<UserStore>();

/**
 * Run `fn` with `userId` bound as the current user for its whole async subtree.
 * `opts.isAnonymous` marks a guest session (the auth middleware passes it from
 * the verified token); background jobs/CLIs omit it — a job user is never a
 * guest, so it defaults to false.
 */
export function runWithUser<T>(userId: string, fn: () => T, opts?: { isAnonymous?: boolean }): T {
  return storage.run({ userId, isAnonymous: opts?.isAnonymous ?? false }, fn);
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

/**
 * Whether the current request is an anonymous (guest) session. Returns false
 * outside any user context (background jobs never run as a guest), so callers
 * can use it without a try/catch — unlike currentUserId(), it never throws.
 */
export function currentUserIsAnonymous(): boolean {
  return storage.getStore()?.isAnonymous ?? false;
}
