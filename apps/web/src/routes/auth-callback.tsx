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

  // No session materialised and no code left to exchange → treat as a failure
  // after auth has finished loading.
  useEffect(() => {
    if (loading || session || failed) return;
    const hasCode = params.get("code");
    if (!hasCode) setFailed(t("Auth.callbackError"));
  }, [loading, session, failed, params, t]);

  // Send failures back to the auth page (it shows a fresh sign-in form). The
  // provider error text is transient; retrying is the right recovery.
  if (failed) return <Navigate to={`/${locale}/auth`} replace />;

  return <FullScreenLoader />;
}
