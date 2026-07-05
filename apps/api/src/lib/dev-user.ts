/**
 * Pre-auth dev user stand-in (removed in Session 15). Every handler acts as
 * this user for user-scoped data — see CLAUDE.md § Dev conventions.
 */
export function devUserId(): string {
  const id = process.env.DEV_USER_ID;
  if (!id) throw new Error("DEV_USER_ID is not set (apps/api/.env)");
  return id;
}
