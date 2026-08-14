import { useState, type FormEvent } from "react";
import { Navigate, useSearchParams, useNavigate, useLocation, Link } from "react-router";
import { useTranslation } from "react-i18next";
import { Loader2, Mail, ArrowLeft, LogIn } from "lucide-react";
import { useAuth } from "@/providers/auth-provider";
import { useLocale } from "@/hooks/use-locale";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FullScreenLoader } from "@/routes/require-auth";
import { BrandMark } from "@/components/marketing/brand-mark";
import { BrandPanel } from "@/components/marketing/brand-panel";
import { GuestEntryButton } from "@/components/marketing/guest-entry-button";
import { SUPPORTED_LOCALES, switchLocale, LOCALE_STORAGE_KEY, type Locale } from "@/lib/locale";
import { cn } from "@/lib/utils";

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

type Step = "options" | "otp" | "forgot";
type Mode = "signin" | "signup";

export function Component() {
  const { t } = useTranslation();
  const locale = useLocale();
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const {
    session,
    loading,
    isGuest,
    signInWithGoogle,
    signInWithPassword,
    signUpWithPassword,
    linkGoogle,
    convertGuestWithPassword,
    sendEmailOtp,
    verifyEmailOtp,
    sendPasswordReset,
  } = useAuth();

  const redirectTarget = params.get("redirect") || `/${locale}/dashboard`;

  const [step, setStep] = useState<Step>("options");
  // A guest is here to CONVERT (save progress) — default to the create-account
  // form rather than sign-in. `?mode=signup` (the marketing header's Sign-up
  // button) does the same for a fresh visitor, so Log in and Sign up are two
  // different destinations rather than one screen with two labels. Read once as
  // the initial value: this is the form's own state afterwards, so the in-page
  // toggle must not be overridden on every render by a stale URL.
  const [mode, setMode] = useState<Mode>(() =>
    isGuest || params.get("mode") === "signup" ? "signup" : "signin",
  );
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [busy, setBusy] = useState(false);
  // Seed from a `?error=` param so an OAuth-callback failure surfaces its reason
  // here instead of a silent bounce back to a blank form.
  const [error, setError] = useState<string | null>(() => params.get("error"));
  const [notice, setNotice] = useState<string | null>(null);

  if (loading) return <FullScreenLoader />;
  // A REAL signed-in user has nothing to do here — RequireAuth handles the
  // onboarding gate downstream. A GUEST, though, stays: this page is where they
  // convert to a real account (which preserves their progress).
  if (session && !isGuest) return <Navigate to={redirectTarget} replace />;

  async function handleGoogle() {
    setBusy(true);
    setError(null);
    try {
      // Bounce back through our callback route, carrying the intended path.
      const callback = new URL(`/${locale}/auth/callback`, window.location.origin);
      callback.searchParams.set("redirect", redirectTarget);
      // A guest LINKS Google to keep the same account (data preserved); a fresh
      // visitor signs in with Google normally.
      if (isGuest) await linkGoogle(callback.toString());
      else await signInWithGoogle(callback.toString());
      // Browser now navigates to Google; nothing further runs here on success.
    } catch (err) {
      setError(err instanceof Error ? err.message : t("Auth.genericError"));
      setBusy(false);
    }
  }

  // Email + password — the primary path (sends no email, so it's never blocked
  // by the OTP email rate limit).
  async function handlePassword(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (mode === "signin") {
        // A guest signing into an EXISTING account switches to it (guest progress,
        // owned by the anonymous id, stays behind — the create-account path is the
        // one that preserves it). A fresh visitor just signs in.
        await signInWithPassword(email.trim(), password);
        navigate(redirectTarget, { replace: true });
      } else if (isGuest) {
        // Convert the guest in place — same user id, so all progress is preserved.
        const { needsConfirmation } = await convertGuestWithPassword(email.trim(), password);
        if (needsConfirmation) {
          setNotice(t("Auth.signupCheckEmail"));
          setPassword("");
          setBusy(false);
        } else {
          navigate(redirectTarget, { replace: true }); // RequireAuth grants the trial + onboarding
        }
      } else {
        const { needsConfirmation } = await signUpWithPassword(email.trim(), password);
        if (needsConfirmation) {
          setNotice(t("Auth.signupCheckEmail"));
          setMode("signin");
          setPassword("");
        } else {
          navigate(redirectTarget, { replace: true });
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t("Auth.signInError"));
      setBusy(false);
    }
  }

  async function handleSendReset(e: FormEvent) {
    e.preventDefault();
    if (!email.trim()) {
      setError(t("Auth.enterEmailFirst"));
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const redirectTo = new URL(`/${locale}/auth/reset`, window.location.origin).toString();
      await sendPasswordReset(email.trim(), redirectTo);
      setStep("options");
      setMode("signin");
      setNotice(t("Auth.resetLinkSent"));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("Auth.genericError"));
    } finally {
      setBusy(false);
    }
  }

  // OTP is now the fallback — reached from "Email me a one-time code instead".
  async function handleUseCode() {
    if (!email.trim()) {
      setError(t("Auth.enterEmailFirst"));
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
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

  // Same unauthenticated toggle idiom as landing.tsx/pricing.tsx — no session
  // to persist the preference to yet, just the URL + localStorage.
  function setLocale(next: Locale) {
    if (next === locale) return;
    localStorage.setItem(LOCALE_STORAGE_KEY, next);
    navigate(switchLocale(location.pathname, location.search, next, location.hash));
  }

  return (
    // docs/design/reference-1's LOGIN / SIGNUP page: the navy brand panel
    // beside the form. The panel is lg-only — at 390px it would push the
    // fields below the fold, and this screen exists to be filled in, not
    // admired. Everything inside the form column is unchanged.
    <div className="grid min-h-svh bg-background lg:grid-cols-2">
      <aside className="hidden p-6 lg:block">
        <BrandPanel className="flex h-full flex-col items-center justify-center gap-6 py-12">
          <div className="text-center">
            <p className="font-heading text-3xl font-extrabold leading-[1.2] tracking-tight text-white">
              {t("Landing.heroLine1")}
              <br />
              {/* On this fixed navy field the raw brand gold is the RIGHT
                  choice — 12:1 — unlike the light page, where the same value
                  is 1.5:1. The panel never flips, so neither does this. */}
              <span className="text-brand-gold">{t("Landing.heroAccent")}</span> {t("Landing.heroLine2")}
            </p>
            <p className="mt-4 text-base leading-relaxed text-white/75">{t("Auth.panelTagline")}</p>
          </div>
        </BrandPanel>
      </aside>

      {/* min-w-0: a grid item defaults to min-width:auto, so it refuses to
          shrink below its content's min-content width — without this the page
          scrolled 3px wide at 390px, in English only (its longest unbreakable
          token is wider than the Hindi one, which is why a Hindi-only check
          would have missed it). */}
      <div className="flex min-h-svh min-w-0 flex-col bg-background px-4 py-10 lg:min-h-0">
      <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center">
        <div className="mb-8 flex items-center justify-between gap-3">
          <Link to={`/${locale}`} className="inline-flex" aria-label={t("Landing.brand")}>
            <BrandMark />
          </Link>
          <div className="flex items-center gap-0.5 rounded-full border border-border p-0.5">
            {SUPPORTED_LOCALES.map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => setLocale(l)}
                aria-pressed={l === locale}
                className={cn(
                  "min-h-8 rounded-full px-2.5 text-xs font-semibold uppercase transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  l === locale ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {l}
              </button>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-8">
          {/* The heading follows the MODE, so arriving via the header's
              "Sign up" doesn't greet a brand-new visitor with "Welcome back". */}
          <h1 className="text-center font-heading text-2xl font-bold tracking-tight">
            {isGuest ? t("Auth.guestTitle") : mode === "signup" ? t("Auth.signupTitle") : t("Auth.welcomeBack")}
          </h1>
          <p className="mt-2 text-center text-sm leading-relaxed text-muted-foreground">
            {isGuest ? t("Auth.guestSubtitle") : mode === "signup" ? t("Auth.signupSubtitle") : t("Auth.subtitle")}
          </p>
          {isGuest ? (
            <p className="mt-4 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-center text-xs leading-relaxed text-foreground">
              {t("Auth.guestPreserveNote")}
            </p>
          ) : null}

          {error ? (
            <p
              role="alert"
              className="mt-5 rounded-lg border border-coral/40 bg-coral/10 px-3 py-2 text-sm text-coral-foreground"
            >
              {error}
            </p>
          ) : null}
          {notice ? (
            <p
              role="status"
              className="mt-5 rounded-lg border border-tulsi/40 bg-tulsi/10 px-3 py-2 text-sm text-tulsi-foreground"
            >
              {notice}
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

              <form onSubmit={handlePassword} className="space-y-3">
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
                <label className="block">
                  <span className="mb-1.5 block text-sm font-medium">{t("Auth.passwordLabel")}</span>
                  <Input
                    type="password"
                    autoComplete={mode === "signin" ? "current-password" : "new-password"}
                    required
                    placeholder={t("Auth.passwordPlaceholder")}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </label>
                {mode === "signin" && (
                  <button
                    type="button"
                    className="block text-right text-sm font-medium text-primary hover:underline"
                    onClick={() => {
                      setStep("forgot");
                      setError(null);
                      setNotice(null);
                    }}
                  >
                    {t("Auth.forgotPassword")}
                  </button>
                )}
                <Button
                  type="submit"
                  size="lg"
                  className="h-11 w-full gap-2 text-base"
                  disabled={busy || !email || !password}
                >
                  {busy ? <Loader2 className="size-5 animate-spin" /> : <LogIn className="size-5" />}
                  {mode === "signin" ? t("Auth.signIn") : t("Auth.createAccount")}
                </Button>
              </form>

              <button
                type="button"
                className="block w-full text-center text-sm font-medium text-primary hover:underline"
                onClick={() => {
                  setMode((m) => (m === "signin" ? "signup" : "signin"));
                  setError(null);
                  setNotice(null);
                }}
              >
                {mode === "signin" ? t("Auth.noAccount") : t("Auth.haveAccount")}
              </button>

              <div className="flex items-center gap-3 py-1">
                <span className="h-px flex-1 bg-border" />
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {t("Auth.or")}
                </span>
                <span className="h-px flex-1 bg-border" />
              </div>

              <Button
                type="button"
                variant="ghost"
                size="lg"
                className="h-11 w-full gap-2 text-base"
                onClick={handleUseCode}
                disabled={busy}
              >
                <Mail className="size-5" />
                {t("Auth.useCodeInstead")}
              </Button>

              <p className="text-center text-xs leading-relaxed text-muted-foreground">{t("Auth.phoneSoon")}</p>

              {!isGuest ? (
                <>
                  <div className="flex items-center gap-3 py-1">
                    <span className="h-px flex-1 bg-border" />
                    <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      {t("Auth.or")}
                    </span>
                    <span className="h-px flex-1 bg-border" />
                  </div>
                  <GuestEntryButton variant="ghost" className="items-stretch" />
                </>
              ) : null}
            </div>
          ) : step === "forgot" ? (
            <form onSubmit={handleSendReset} className="mt-6 space-y-4">
              <p className="text-sm leading-relaxed text-muted-foreground">{t("Auth.forgotPasswordDescription")}</p>
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
              <Button type="submit" size="lg" className="h-11 w-full text-base" disabled={busy || !email.trim()}>
                {busy ? <Loader2 className="size-5 animate-spin" /> : <Mail className="size-5" />}
                {t("Auth.sendResetLink")}
              </Button>
              <button
                type="button"
                className="flex w-full items-center justify-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
                onClick={() => {
                  setStep("options");
                  setError(null);
                  setNotice(null);
                }}
              >
                <ArrowLeft className="size-4" /> {t("Auth.backToSignIn")}
              </button>
            </form>
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
                {/* Always mounted (see exam-switch-dialog.tsx) so the
                    button's `has-[>svg]:px-*` size variant never toggles
                    mid-submit — conditionally mounting this animated the
                    button's own padding via `transition-all` at the exact
                    moment `disabled` engaged, which a real captured frame
                    showed as doubled/ghosted text elsewhere in this app.
                    Only opacity/animation change now. The trailing spacer
                    mirrors the icon so the label stays centred instead of
                    the icon+label GROUP being centred (which pushes the
                    label off-centre at rest — also caught live). */}
                <Loader2 className={cn("size-5", busy ? "animate-spin opacity-100" : "opacity-0")} aria-hidden />
                {t("Auth.otpVerify")}
                <span className="size-5" aria-hidden />
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
    </div>
  );
}
