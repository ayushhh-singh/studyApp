import { useState, type FormEvent } from "react";
import { Navigate, useSearchParams, useNavigate, Link } from "react-router";
import { useTranslation } from "react-i18next";
import { Loader2, Mail, ArrowLeft } from "lucide-react";
import { useAuth } from "@/providers/auth-provider";
import { useLocale } from "@/hooks/use-locale";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FullScreenLoader } from "@/routes/require-auth";
import { BrandMark } from "@/components/marketing/brand-mark";

/** Google "G" — inlined so no external asset is fetched (CSP-safe). */
function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-5" aria-hidden>
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1Z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84Z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.06l3.66 2.84C6.71 7.3 9.14 5.38 12 5.38Z"
      />
    </svg>
  );
}

type Step = "options" | "otp";

export function Component() {
  const { t } = useTranslation();
  const locale = useLocale();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { session, loading, signInWithGoogle, sendEmailOtp, verifyEmailOtp } = useAuth();

  const redirectTarget = params.get("redirect") || `/${locale}/dashboard`;

  const [step, setStep] = useState<Step>("options");
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (loading) return <FullScreenLoader />;
  // Already signed in — RequireAuth handles the onboarding gate downstream.
  if (session) return <Navigate to={redirectTarget} replace />;

  async function handleGoogle() {
    setBusy(true);
    setError(null);
    try {
      // Bounce back through our callback route, carrying the intended path.
      const callback = new URL(`/${locale}/auth/callback`, window.location.origin);
      callback.searchParams.set("redirect", redirectTarget);
      await signInWithGoogle(callback.toString());
      // Browser now navigates to Google; nothing further runs here on success.
    } catch (err) {
      setError(err instanceof Error ? err.message : t("Auth.genericError"));
      setBusy(false);
    }
  }

  async function handleSendOtp(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await sendEmailOtp(email.trim());
      setStep("otp");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("Auth.genericError"));
    } finally {
      setBusy(false);
    }
  }

  async function handleVerifyOtp(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await verifyEmailOtp(email.trim(), otp.trim());
      navigate(redirectTarget, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : t("Auth.otpError"));
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
          <h1 className="text-center text-xl font-bold tracking-tight sm:text-2xl">{t("Auth.title")}</h1>
          <p className="mt-2 text-center text-sm leading-relaxed text-muted-foreground">{t("Auth.subtitle")}</p>

          {error ? (
            <p
              role="alert"
              className="mt-5 rounded-lg border border-coral/40 bg-coral/10 px-3 py-2 text-sm text-coral-foreground"
            >
              {error}
            </p>
          ) : null}

          {step === "options" ? (
            <div className="mt-6 space-y-4">
              <Button
                type="button"
                variant="outline"
                size="lg"
                className="h-11 w-full gap-3 text-base"
                onClick={handleGoogle}
                disabled={busy}
              >
                {busy ? <Loader2 className="size-5 animate-spin" /> : <GoogleIcon />}
                {t("Auth.google")}
              </Button>

              <div className="flex items-center gap-3 py-1">
                <span className="h-px flex-1 bg-border" />
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {t("Auth.or")}
                </span>
                <span className="h-px flex-1 bg-border" />
              </div>

              <form onSubmit={handleSendOtp} className="space-y-3">
                <label className="block">
                  <span className="mb-1.5 block text-sm font-medium">{t("Auth.emailLabel")}</span>
                  <Input
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    required
                    placeholder={t("Auth.emailPlaceholder")}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </label>
                <Button type="submit" size="lg" className="h-11 w-full gap-2 text-base" disabled={busy || !email}>
                  {busy ? <Loader2 className="size-5 animate-spin" /> : <Mail className="size-5" />}
                  {t("Auth.emailContinue")}
                </Button>
              </form>

              <p className="text-center text-xs leading-relaxed text-muted-foreground">{t("Auth.phoneSoon")}</p>
            </div>
          ) : (
            <form onSubmit={handleVerifyOtp} className="mt-6 space-y-4">
              <p className="text-sm leading-relaxed text-muted-foreground">
                {t("Auth.otpSentTo")} <span className="font-semibold text-foreground">{email}</span>
              </p>
              <label className="block">
                <span className="mb-1.5 block text-sm font-medium">{t("Auth.otpLabel")}</span>
                <Input
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]*"
                  maxLength={6}
                  required
                  placeholder="••••••"
                  className="text-center text-lg tracking-[0.5em] font-semibold tabular-nums"
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
                />
              </label>
              <Button type="submit" size="lg" className="h-11 w-full text-base" disabled={busy || otp.length < 6}>
                {busy ? <Loader2 className="size-5 animate-spin" /> : null}
                {t("Auth.otpVerify")}
              </Button>
              <button
                type="button"
                className="flex w-full items-center justify-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
                onClick={() => {
                  setStep("options");
                  setOtp("");
                  setError(null);
                }}
              >
                <ArrowLeft className="size-4" /> {t("Auth.otpBack")}
              </button>
            </form>
          )}
        </div>

        <p className="mt-6 text-center text-xs leading-relaxed text-muted-foreground">{t("Auth.terms")}</p>
      </div>
    </div>
  );
}
