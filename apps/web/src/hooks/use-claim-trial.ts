import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { claimTrialResponseSchema } from "@neev/shared";
import { api } from "@/lib/api";
import { useAuth } from "@/providers/auth-provider";
import { clearTrialClaimPending, hasTrialClaimPending } from "@/lib/guest";

/**
 * Grants the 7-day Pro trial the instant a GUEST becomes a real account.
 *
 * handle_new_user() (migration 0104) grants the trial only on a real-signup
 * INSERT; converting a guest is an auth.users UPDATE that never re-fires it, so
 * the client asks the server to grant it (POST /auth/claim-trial, idempotent).
 * We fire it only when a pending flag was set at conversion time — so a fresh
 * (never-guest) signup makes no redundant call — and the flag lives in
 * localStorage so it survives the Google OAuth redirect. Mounted in RequireAuth,
 * which is in the tree for every post-conversion route (onboarding, app shell).
 */
export function useClaimTrialOnConversion(): void {
  const { user, isGuest } = useAuth();
  const qc = useQueryClient();
  const firing = useRef(false);

  useEffect(() => {
    if (!user || isGuest) return; // only once genuinely converted to a real account
    if (!hasTrialClaimPending()) return; // only right after a guest conversion
    if (firing.current) return;
    firing.current = true;
    void (async () => {
      try {
        await api.post("/api/v1/auth/claim-trial", claimTrialResponseSchema);
        clearTrialClaimPending();
        await Promise.all([
          qc.invalidateQueries({ queryKey: ["billing"] }),
          qc.invalidateQueries({ queryKey: ["profile"] }),
        ]);
      } catch {
        // Leave the flag set so a later mount retries; never block the app.
        firing.current = false;
      }
    })();
  }, [user, isGuest, qc]);
}
