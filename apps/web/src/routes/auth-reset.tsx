import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";
import { Loader2, KeyRound, AlertTriangle } from "lucide-react";
import { checkPasswordStrength } from "@prayasup/shared";
import { supabaseBrowser } from "@/lib/supabase";
import { useAuth } from "@/providers/auth-provider";
import { useLocale } from "@/hooks/use-locale";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FullScreenLoader } from "@/routes/require-auth";
import { BrandMark } from "@/components/marketing/brand-mark";

/**
 * Landing page for a Supabase password-recovery email link. supabase-js
 * (detectSessionInUrl, PKCE) exchanges the URL's recovery `code` for a
 * session automatically and fires a "PASSWORD_RECOVERY" auth event — we
 * listen for that (with a session+code fallback for older client behavior)
 * rather than trusting session presence alone, since a signed-in visitor who
 * lands here with no code at all would otherwise sail through as "ready".
 * An expired/invalid link comes back as `?error=...&error_description=...`,
 * same shape as the OAuth callback route.
 */
export function Component() {
  const { t } = useTranslation();
  const locale = useLocale();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { loading: authLoading, session, updatePassword } = useAuth();

  const [recoveryReady, setRecoveryReady] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(
    () => params.get("error_description") || params.get("error"),
  );
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const {
      data: { subscription },
    } = supabaseBrowser().auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") setRecoveryReady(true);
    });
    return () => subscription.unsubscribe();
  }, []);

  // Fallback: if the recovery code was already exchanged before this
  // listener attached, a session + a `code` param still means we got here
  // legitimately via the reset link.
  useEffect(() => {
    if (!recoveryReady && !authLoading && session && params.get("code")) {
      setRecoveryReady(true);
    }
  }, [recoveryReady, authLoading, session, params]);

  // No code, no error, no session by the time auth resolves — nothing to
  // recover from (e.g. someone navigated here directly). Don't spin forever.
  useEffect(() => {
    if (authLoading || recoveryReady || linkError) return;
    if (!params.get("code")) setLinkError(t("Auth.resetLinkInvalid"));
  }, [authLoading, recoveryReady, linkError, params, t]);

  // A code that's already been consumed (a pre-clicked/scanned link, a
  // double-open) fails the exchange silently: no PASSWORD_RECOVERY event, no
  // session — but the code param stays in the URL, so the effect above never
  // fires either. Without this, the page would spin on <FullScreenLoader/>
  // forever. Give the exchange a generous real-world window, then treat a
  // still-not-ready state as an honest invalid-link error instead.
  useEffect(() => {
    if (!params.get("code") || recoveryReady || linkError) return;
    const timer = setTimeout(() => setLinkError(t("Auth.resetLinkInvalid")), 8000);
    return () => clearTimeout(timer);
  }, [params, recoveryReady, linkError, t]);

  if (authLoading) return <FullScreenLoader />;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const strength = checkPasswordStrength(password);
    if (!strength.ok) {
      setError(t(strength.reason === "too_short" ? "Auth.passwordTooShort" : "Auth.passwordTooCommon"));
      return;
    }
    if (password !== confirm) {
      setError(t("Auth.resetMismatch"));
      return;
    }
    setBusy(true);
    try {
      await updatePassword(password);
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("Auth.genericError"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-svh flex-col bg-background px-4 py-10">
      <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center">
        <Link to={`/${locale}`} className="mx-auto mb-8 inline-flex" aria-label={t("Landing.brand")}>
          <BrandMark />
        </Link>

        <div className="rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-8">
          {linkError ? (
            <div className="flex flex-col items-center gap-3 text-center">
              <span className="flex size-11 items-center justify-center rounded-full bg-coral/10 text-coral">
                <AlertTriangle className="size-5" aria-hidden />
              </span>
              <h1 className="text-xl font-bold tracking-tight">{t("Auth.resetLinkInvalidTitle")}</h1>
              <p className="text-sm leading-relaxed text-muted-foreground">{t("Auth.resetLinkInvalid")}</p>
              <Button asChild size="lg" className="mt-2 h-11 w-full text-base">
                <Link to={`/${locale}/auth`}>{t("Auth.resetLinkInvalidCta")}</Link>
              </Button>
            </div>
          ) : done ? (
            <div className="flex flex-col items-center gap-3 text-center">
              <span className="flex size-11 items-center justify-center rounded-full bg-tulsi/10 text-tulsi-foreground">
                <KeyRound className="size-5" aria-hidden />
              </span>
              <h1 className="text-xl font-bold tracking-tight">{t("Auth.resetSuccess")}</h1>
              <Button
                size="lg"
                className="mt-2 h-11 w-full text-base"
                onClick={() => navigate(`/${locale}/dashboard`, { replace: true })}
              >
                {t("Auth.resetSuccessContinue")}
              </Button>
            </div>
          ) : !recoveryReady ? (
            <FullScreenLoader />
          ) : (
            <>
              <h1 className="text-center text-xl font-bold tracking-tight sm:text-2xl">{t("Auth.resetTitle")}</h1>
              <p className="mt-2 text-center text-sm leading-relaxed text-muted-foreground">
                {t("Auth.resetDescription")}
              </p>

              {error ? (
                <p
                  role="alert"
                  className="mt-5 rounded-lg border border-coral/40 bg-coral/10 px-3 py-2 text-sm text-coral-foreground"
                >
                  {error}
                </p>
              ) : null}

              <form onSubmit={handleSubmit} className="mt-6 space-y-3">
                <label className="block">
                  <span className="mb-1.5 block text-sm font-medium">{t("Auth.resetNewPasswordLabel")}</span>
                  <Input
                    type="password"
                    autoComplete="new-password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                  <span className="mt-1.5 block text-xs text-muted-foreground">{t("Auth.passwordHint")}</span>
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-sm font-medium">{t("Auth.resetConfirmPasswordLabel")}</span>
                  <Input
                    type="password"
                    autoComplete="new-password"
                    required
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                  />
                </label>
                <Button
                  type="submit"
                  size="lg"
                  className="h-11 w-full gap-2 text-base"
                  disabled={busy || !password || !confirm}
                >
                  {busy ? <Loader2 className="size-5 animate-spin" /> : <KeyRound className="size-5" />}
                  {t("Auth.resetSubmit")}
                </Button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
