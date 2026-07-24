import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, Navigate, useLocation, useNavigate, useParams } from "react-router";
import { ArrowLeft, ArrowRight, Bell, BellRing, Check, Heart, Loader2 } from "lucide-react";
import type { SukoonChatLanguage, SukoonOnboardingBody } from "@neev/shared";
import { useAuth } from "@/providers/auth-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NotTherapyFooter } from "@/sukoon/components/not-therapy-footer";
import { useSukoonLanguage } from "@/sukoon/lib/use-sukoon-language";
import { useCompleteSukoonOnboarding, useSukoonProfile } from "@/sukoon/lib/use-sukoon-profile";
import { cn } from "@/lib/utils";

const TOTAL_STEPS = 6;
const LANGUAGES: SukoonChatLanguage[] = ["hi", "hinglish", "en"];
const WHO5_QUESTIONS = ["q1", "q2", "q3", "q4", "q5"] as const;
const WHO5_SCALE = [0, 1, 2, 3, 4, 5] as const;
const ATTEMPT_OPTIONS = [1, 2, 3, 4, 5] as const; // 5 renders as "5+"

/** Read Notification.permission defensively (absent in some webviews). */
function currentNotifPermission(): NotificationPermission | "unsupported" {
  if (typeof Notification === "undefined") return "unsupported";
  return Notification.permission;
}

export function Component() {
  const { t, language: uiLang } = useSukoonLanguage();
  const { session } = useAuth();
  const { locale } = useParams<{ locale?: string }>();
  const location = useLocation();
  const navigate = useNavigate();

  const profileQuery = useSukoonProfile({ enabled: !!session });
  const onboard = useCompleteSukoonOnboarding();

  const [step, setStep] = useState(1);
  const [chatLang, setChatLang] = useState<SukoonChatLanguage | null>(null);
  const [consentScrolled, setConsentScrolled] = useState(false);
  const [consentAccepted, setConsentAccepted] = useState(false);
  const [age18, setAge18] = useState<boolean | null>(null);
  const [who5, setWho5] = useState<(number | null)[]>([null, null, null, null, null]);
  const [exam, setExam] = useState("");
  const [attempt, setAttempt] = useState<number | null>(null);
  const [examDate, setExamDate] = useState("");
  const [reminderTime, setReminderTime] = useState("");
  const [notif, setNotif] = useState<NotificationPermission | "unsupported">(() => currentNotifPermission());
  const [error, setError] = useState<string | null>(null);

  const consentRef = useRef<HTMLDivElement>(null);

  // If the consent text fits without scrolling, there's nothing to scroll —
  // enable acceptance immediately (re-checked when the user reaches step 2).
  useEffect(() => {
    if (step !== 2) return;
    const el = consentRef.current;
    if (el && el.scrollHeight <= el.clientHeight + 4) setConsentScrolled(true);
  }, [step]);

  // Already onboarded (hit /onboarding directly) → into the app.
  if (session && profileQuery.data?.profile?.onboarding_completed) {
    return <Navigate to=".." relative="path" replace />;
  }

  // Anonymous visitor reached onboarding directly. Sukoon pages are reachable
  // pre-login, but onboarding writes a profile keyed to the account — so ask
  // them to sign in first (integrated mode has a Neev auth route to point at).
  if (!session) {
    const redirect = encodeURIComponent(`${location.pathname}${location.search}`);
    return (
      <div className="mx-auto flex min-h-svh max-w-md flex-col items-center justify-center gap-5 px-5 text-center">
        <Heart className="size-8 text-secondary" aria-hidden />
        <div className="space-y-1.5">
          <h1 className="text-xl font-bold tracking-tight" lang={uiLang}>
            {t("Sukoon.onboarding.signInTitle")}
          </h1>
          <p className="text-sm leading-relaxed text-muted-foreground" lang={uiLang}>
            {t("Sukoon.onboarding.signInSub")}
          </p>
        </div>
        {locale ? (
          <Button asChild>
            <Link to={`/${locale}/auth?redirect=${redirect}`}>{t("Sukoon.onboarding.signInCta")}</Link>
          </Button>
        ) : null}
        <NotTherapyFooter className="mt-4" />
      </div>
    );
  }

  const who5Complete = who5.every((v) => v !== null);
  const canAdvance =
    (step === 1 && chatLang !== null) ||
    (step === 2 && consentAccepted) ||
    (step === 3 && age18 !== null) ||
    step === 4 ||
    step === 5 ||
    step === 6;

  async function finish() {
    if (chatLang === null || age18 === null) return;
    setError(null);
    const body: SukoonOnboardingBody = {
      language: chatLang,
      consent_accepted: true,
      age_confirmed_18: age18,
      who5: who5Complete ? (who5 as number[]) : null,
      exam: exam.trim() ? exam.trim() : null,
      exam_attempt: attempt,
      exam_date: examDate ? examDate : null,
      reminder_time: reminderTime ? reminderTime : null,
    };
    try {
      await onboard.mutateAsync(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("Sukoon.onboarding.error"));
      return;
    }
    // Relative to this route → the Sukoon home (mount index), integrated or standalone.
    navigate("..", { relative: "path", replace: true });
  }

  async function askNotifications() {
    if (typeof Notification === "undefined") return;
    try {
      setNotif(await Notification.requestPermission());
    } catch {
      /* user dismissed — leave state as-is */
    }
  }

  return (
    <div className="flex min-h-svh flex-col px-4 py-8">
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col">
        <div className="mb-6 flex items-center gap-2">
          <Heart className="size-5 text-secondary" aria-hidden />
          <span className="text-lg font-bold tracking-tight" lang={uiLang}>
            {t("Sukoon.brand")}
          </span>
        </div>

        {/* Progress */}
        <div className="mb-6 flex items-center gap-1.5" aria-hidden>
          {Array.from({ length: TOTAL_STEPS }, (_, i) => (
            <span
              key={i}
              className={cn(
                "h-1.5 flex-1 rounded-full transition-colors",
                i < step ? "bg-secondary" : "bg-border",
              )}
            />
          ))}
        </div>
        <p className="sr-only" aria-live="polite">
          {t("Sukoon.onboarding.stepProgress", { current: step, total: TOTAL_STEPS })}
        </p>

        <div className="flex-1 rounded-2xl border border-border bg-card p-6 shadow-sm" lang={uiLang}>
          {step === 1 ? (
            <Step title={t("Sukoon.onboarding.langTitle")} sub={t("Sukoon.onboarding.langSub")}>
              <div className="space-y-2.5">
                {LANGUAGES.map((l) => (
                  <button
                    key={l}
                    type="button"
                    onClick={() => setChatLang(l)}
                    aria-pressed={chatLang === l}
                    className={cn(
                      "flex min-h-11 w-full flex-col rounded-xl border px-4 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      chatLang === l
                        ? "border-secondary bg-secondary/10 ring-1 ring-secondary"
                        : "border-border hover:bg-accent",
                    )}
                  >
                    <span className="text-base font-semibold">{t(`Sukoon.onboarding.lang_${l}`)}</span>
                    <span className="text-xs text-muted-foreground">
                      {t(`Sukoon.onboarding.lang_${l}_desc`)}
                    </span>
                  </button>
                ))}
              </div>
            </Step>
          ) : null}

          {step === 2 ? (
            <Step title={t("Sukoon.onboarding.consentTitle")} sub={t("Sukoon.onboarding.consentSub")}>
              <div
                ref={consentRef}
                onScroll={(e) => {
                  const el = e.currentTarget;
                  if (el.scrollTop + el.clientHeight >= el.scrollHeight - 8) setConsentScrolled(true);
                }}
                className="max-h-56 space-y-3 overflow-y-auto rounded-xl border border-border bg-background/60 p-4 text-sm leading-[1.85]"
              >
                <p>{t("Sukoon.onboarding.consentP1")}</p>
                <p>{t("Sukoon.onboarding.consentP2")}</p>
                <p>{t("Sukoon.onboarding.consentP3")}</p>
                <p className="font-medium text-foreground">{t("Sukoon.onboarding.consentP4")}</p>
              </div>
              {!consentScrolled ? (
                <p className="mt-2 text-center text-xs text-muted-foreground">
                  {t("Sukoon.onboarding.consentScrollHint")}
                </p>
              ) : null}
              <button
                type="button"
                role="checkbox"
                aria-checked={consentAccepted}
                disabled={!consentScrolled}
                onClick={() => setConsentAccepted((v) => !v)}
                className={cn(
                  "mt-4 flex min-h-11 w-full items-center gap-3 rounded-xl border px-4 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50",
                  consentAccepted ? "border-secondary bg-secondary/10" : "border-border",
                )}
              >
                <span
                  className={cn(
                    "flex size-5 shrink-0 items-center justify-center rounded-md border",
                    consentAccepted ? "border-secondary bg-secondary text-secondary-foreground" : "border-input",
                  )}
                  aria-hidden
                >
                  {consentAccepted ? <Check className="size-3.5" /> : null}
                </span>
                <span className="text-sm font-medium">{t("Sukoon.onboarding.consentAccept")}</span>
              </button>
            </Step>
          ) : null}

          {step === 3 ? (
            <Step title={t("Sukoon.onboarding.ageTitle")} sub={t("Sukoon.onboarding.ageSub")}>
              <div className="space-y-2.5">
                {[true, false].map((is18) => (
                  <button
                    key={String(is18)}
                    type="button"
                    onClick={() => setAge18(is18)}
                    aria-pressed={age18 === is18}
                    className={cn(
                      "flex min-h-11 w-full items-center rounded-xl border px-4 py-3 text-left text-base font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      age18 === is18
                        ? "border-secondary bg-secondary/10 ring-1 ring-secondary"
                        : "border-border hover:bg-accent",
                    )}
                  >
                    {t(is18 ? "Sukoon.onboarding.age18" : "Sukoon.onboarding.ageUnder")}
                  </button>
                ))}
              </div>
              {age18 === false ? (
                <p className="mt-3 rounded-xl border border-secondary/30 bg-secondary/5 px-3.5 py-3 text-xs leading-relaxed text-muted-foreground">
                  {t("Sukoon.onboarding.ageRestrictedNote")}
                </p>
              ) : null}
            </Step>
          ) : null}

          {step === 4 ? (
            <Step title={t("Sukoon.onboarding.who5Title")} sub={t("Sukoon.onboarding.who5Sub")}>
              <div className="space-y-4">
                {WHO5_QUESTIONS.map((q, qi) => (
                  <fieldset key={q}>
                    <legend className="mb-1.5 text-sm font-medium leading-snug">
                      {t(`Sukoon.who5.${q}`)}
                    </legend>
                    <div className="flex gap-1.5" role="radiogroup" aria-label={t(`Sukoon.who5.${q}`)}>
                      {WHO5_SCALE.map((s) => (
                        <button
                          key={s}
                          type="button"
                          role="radio"
                          aria-checked={who5[qi] === s}
                          aria-label={t(`Sukoon.who5.s${s}`)}
                          onClick={() =>
                            setWho5((prev) => prev.map((v, i) => (i === qi ? s : v)))
                          }
                          className={cn(
                            "flex min-h-11 flex-1 items-center justify-center rounded-lg border text-sm font-semibold tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                            who5[qi] === s
                              ? "border-secondary bg-secondary/15 text-secondary-foreground"
                              : "border-border hover:bg-accent",
                          )}
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  </fieldset>
                ))}
                <div className="flex justify-between text-[11px] text-muted-foreground">
                  <span>{t("Sukoon.who5.s0")}</span>
                  <span>{t("Sukoon.who5.s5")}</span>
                </div>
              </div>
            </Step>
          ) : null}

          {step === 5 ? (
            <Step title={t("Sukoon.onboarding.examTitle")} sub={t("Sukoon.onboarding.examSub")}>
              <div className="space-y-4">
                <label className="block">
                  <span className="mb-1.5 block text-sm font-medium">
                    {t("Sukoon.onboarding.examNameLabel")}
                  </span>
                  <Input
                    value={exam}
                    onChange={(e) => setExam(e.target.value)}
                    placeholder={t("Sukoon.onboarding.examNamePlaceholder")}
                    maxLength={120}
                  />
                </label>
                <div>
                  <span className="mb-1.5 block text-sm font-medium">
                    {t("Sukoon.onboarding.examAttemptLabel")}
                  </span>
                  <div className="grid grid-cols-5 gap-1.5">
                    {ATTEMPT_OPTIONS.map((a) => (
                      <button
                        key={a}
                        type="button"
                        onClick={() => setAttempt((cur) => (cur === a ? null : a))}
                        aria-pressed={attempt === a}
                        className={cn(
                          "flex min-h-11 items-center justify-center rounded-lg border text-sm font-semibold tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                          attempt === a
                            ? "border-secondary bg-secondary/10 ring-1 ring-secondary"
                            : "border-border hover:bg-accent",
                        )}
                      >
                        {a === 5 ? "5+" : a}
                      </button>
                    ))}
                  </div>
                </div>
                <label className="block">
                  <span className="mb-1.5 block text-sm font-medium">
                    {t("Sukoon.onboarding.examDateLabel")}
                  </span>
                  <Input type="date" value={examDate} onChange={(e) => setExamDate(e.target.value)} />
                </label>
              </div>
            </Step>
          ) : null}

          {step === 6 ? (
            <Step title={t("Sukoon.onboarding.reminderTitle")} sub={t("Sukoon.onboarding.reminderSub")}>
              <div className="space-y-4">
                <label className="block">
                  <span className="mb-1.5 block text-sm font-medium">
                    {t("Sukoon.onboarding.reminderTimeLabel")}
                  </span>
                  <Input
                    type="time"
                    value={reminderTime}
                    onChange={(e) => setReminderTime(e.target.value)}
                  />
                </label>
                {notif === "granted" ? (
                  <p className="flex items-center gap-2 rounded-xl border border-secondary/30 bg-secondary/5 px-3.5 py-3 text-sm text-secondary-foreground">
                    <BellRing className="size-4 shrink-0" aria-hidden />
                    {t("Sukoon.onboarding.reminderNotifGranted")}
                  </p>
                ) : notif === "denied" ? (
                  <p className="rounded-xl border border-border bg-muted/40 px-3.5 py-3 text-xs leading-relaxed text-muted-foreground">
                    {t("Sukoon.onboarding.reminderNotifDenied")}
                  </p>
                ) : notif === "default" ? (
                  <Button type="button" variant="outline" className="w-full gap-2" onClick={askNotifications}>
                    <Bell className="size-4" aria-hidden />
                    {t("Sukoon.onboarding.reminderEnableNotif")}
                  </Button>
                ) : null}
              </div>
            </Step>
          ) : null}

          {error ? (
            <p
              role="alert"
              className="mt-4 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {error}
            </p>
          ) : null}
        </div>

        {/* Nav */}
        <div className="mt-6 flex items-center justify-between gap-3">
          {step > 1 ? (
            <Button type="button" variant="ghost" onClick={() => setStep((s) => s - 1)}>
              <ArrowLeft className="size-4" /> {t("Sukoon.onboarding.back")}
            </Button>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-2">
            {step === 4 || step === 5 ? (
              <Button type="button" variant="ghost" onClick={() => setStep((s) => s + 1)}>
                {t("Sukoon.onboarding.skip")}
              </Button>
            ) : null}
            {step < TOTAL_STEPS ? (
              <Button type="button" onClick={() => setStep((s) => s + 1)} disabled={!canAdvance}>
                {t("Sukoon.onboarding.next")} <ArrowRight className="size-4" />
              </Button>
            ) : (
              <Button type="button" onClick={finish} disabled={onboard.isPending}>
                {onboard.isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Check className="size-4" />
                )}
                {t("Sukoon.onboarding.finish")}
              </Button>
            )}
          </div>
        </div>

        <NotTherapyFooter className="mt-6" />
      </div>
    </div>
  );
}

function Step({ title, sub, children }: { title: string; sub: string; children: ReactNode }) {
  return (
    <div className="space-y-5">
      <div className="space-y-1.5">
        <h1 className="text-xl font-bold leading-snug tracking-tight">{title}</h1>
        <p className="text-sm leading-relaxed text-muted-foreground">{sub}</p>
      </div>
      {children}
    </div>
  );
}
