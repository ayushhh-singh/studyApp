import { useEffect, useState } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/providers/auth-provider";
import { useLocale } from "@/hooks/use-locale";
import { FullScreenLoader } from "@/routes/require-auth";

/**
 * OAuth (PKCE) landing route. supabase-js (detectSessionInUrl) exchanges the
 * `?code=` for a session automatically on load; we just wait for the session to
 * appear via the provider, then forward to the intended path. If the URL carries
 * an explicit provider error, surface it and offer a way back to sign-in.
 */
export function Component() {
  const { t } = useTranslation();
  const locale = useLocale();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { session, loading } = useAuth();

  const [failed, setFailed] = useState<string | null>(() => params.get("error_description") || params.get("error"));

  const redirectTarget = params.get("redirect") || `/${locale}/dashboard`;

  useEffect(() => {
    if (!loading && session) {
      navigate(redirectTarget, { replace: true });
    }
  }, [loading, session, navigate, redirectTarget]);

  // Wait for supabase-js's async PKCE exchange (detectSessionInUrl) to produce a
  // session, then declare failure only AFTER a grace window — NEVER the instant
  // we see no `?code=`. The exchange can consume+strip the code a tick before the
  // session propagates through the provider; bailing immediately bounced the user
  // back to sign in and forced a second attempt (the "had to do it twice" bug).
  // If a session arrives within the window the effect re-runs and clears the
  // timer (its guard sees `session`); an explicit `?error=` still fails at once
  // (handled by the initial `failed` state above).
  useEffect(() => {
    if (loading || session || failed) return;
    const timer = setTimeout(() => setFailed(t("Auth.callbackError")), 8000);
    return () => clearTimeout(timer);
  }, [loading, session, failed, t]);

  // Send failures back to the auth page (it shows a fresh sign-in form), carrying
  // the reason so the user sees WHY rather than a silent bounce.
  if (failed) {
    const q = new URLSearchParams({ error: failed });
    return <Navigate to={`/${locale}/auth?${q.toString()}`} replace />;
  }

  return <FullScreenLoader />;
}
