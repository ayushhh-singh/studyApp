import { useMemo } from "react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { BookOpen, CalendarClock, CalendarDays, CheckCircle2, Clock, Lock, PlayCircle } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { TestSeriesEntry } from "@neev/shared";
import { Button } from "@/components/ui/button";
import { usePaywallStore } from "@/stores/paywall-store";
import { useAuth } from "@/providers/auth-provider";
import { cn } from "@/lib/utils";

/**
 * The series calendar's entry list — grouped by month, with a state rail.
 *
 * WHY GROUPED. A series is now 22-35 papers, and an undifferentiated list of 35
 * cards is a wall. Real published schedules are read as a CALENDAR ("what am I
 * doing in November"), so the month is the organising unit and each group states
 * how many of its papers are done. That also gives the eye a resting point every
 * few rows on a 390px screen, which a flat list never does.
 *
 * The left rail carries state as a second, non-colour channel alongside the pill
 * — the design system's rule is that colour is never the only signal.
 */

const STATE: Record<TestSeriesEntry["state"], { pill: string; rail: string; icon: LucideIcon; key: string }> = {
  // "scheduled" and "locked" are both unstartable, but they are not the same
  // fact: locked is a date you are waiting for, scheduled is a paper that does
  // not exist yet. Same muted tone, different icon and label.
  scheduled: {
    pill: "bg-muted text-muted-foreground",
    rail: "bg-border",
    icon: CalendarClock,
    key: "TestSeries.stateScheduled",
  },
  locked: { pill: "bg-muted text-muted-foreground", rail: "bg-border", icon: Lock, key: "TestSeries.stateLocked" },
  open: { pill: "bg-primary/15 text-primary", rail: "bg-primary", icon: PlayCircle, key: "TestSeries.stateOpen" },
  in_progress: {
    pill: "bg-marigold/15 text-marigold-foreground",
    rail: "bg-marigold",
    icon: Clock,
    key: "TestSeries.stateInProgress",
  },
  submitted: {
    pill: "bg-tulsi/15 text-tulsi-foreground",
    rail: "bg-tulsi",
    icon: CheckCircle2,
    key: "TestSeries.stateSubmitted",
  },
  submitted_late: {
    pill: "bg-muted text-muted-foreground",
    rail: "bg-border",
    icon: CheckCircle2,
    key: "TestSeries.stateSubmittedLate",
  },
};

function Pill({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold whitespace-nowrap",
        className,
      )}
    >
      {children}
    </span>
  );
}

/**
 * The start affordance for one series paper, with the Max gate made visible
 * BEFORE the click.
 *
 * ⚑ BROWSING A SERIES IS DELIBERATELY FREE and must stay that way. The calendar
 * is a published study plan — `listSeries`/`getSeriesBySlug` apply no
 * entitlement, only the viewer's own live exam plus `status='published'`. The
 * ONLY Max gate is SITTING a paper, enforced server-side by
 * `assertSeriesAttemptAllowed` → `assertTestSeries` (see
 * docs/max-tier-design.md §5). This component is the client's half of that same
 * rule; do not "tidy it up" by hiding the calendar from non-Max users.
 *
 * Without it a free user meets the gate as a 402 AFTER navigating into the test
 * page, which reads as a broken link rather than as a locked feature.
 *
 * `entitled === null` means the entitlement is still LOADING, and it renders a
 * disabled button rather than guessing either way: "Start test" would send a
 * free user into that 402, and "Unlock with Max" would flash an upgrade pitch at
 * someone who is already paying for it. Same both-flags rule as
 * `lib/query-state.ts` — a still-loading input is not a value.
 */
export function SeriesStartButton({
  testId,
  locale,
  resume,
  entitled,
  className,
}: {
  testId: string;
  locale: "en" | "hi";
  resume: boolean;
  entitled: boolean | null;
  className?: string;
}) {
  const { t } = useTranslation();
  const openPaywall = usePaywallStore((s) => s.openPaywall);
  // A guest cannot hold ANY plan, so pitching a paid tier at them is a step out
  // of order — the paywall sheet itself already branches to "create your free
  // account" for a guest, and the label has to agree with the sheet it opens.
  // Same reasoning as the evaluation quota chip's guest state.
  const { isGuest } = useAuth();

  if (entitled === null) {
    // Sub-second in practice, and it CANNOT stick: a failed entitlement fetch
    // resolves to `true` rather than staying unknown (see useSeriesEntitlement).
    return (
      <Button disabled aria-busy className={cn("min-h-11", className)}>
        {resume ? t("TestSeries.resume") : t("TestSeries.start")}
      </Button>
    );
  }

  if (!entitled) {
    return (
      <Button variant="secondary" className={cn("min-h-11", className)} onClick={() => openPaywall("test_series")}>
        <Lock aria-hidden />
        {isGuest ? t("TestSeries.unlockSignUp") : t("TestSeries.unlockWithMax")}
      </Button>
    );
  }

  return (
    <Button asChild className={cn("min-h-11", className)}>
      <Link to={`/${locale}/practice/test/${testId}`}>{resume ? t("TestSeries.resume") : t("TestSeries.start")}</Link>
    </Button>
  );
}

/**
 * The one-line "you can read all of this, you just cannot sit it yet" notice.
 * Rendered only when the entitlement has RESOLVED to false — an unresolved
 * entitlement shows nothing rather than flashing a pitch at a Max user.
 */
export function SeriesMaxNotice({ entitled, className }: { entitled: boolean | null; className?: string }) {
  const { t } = useTranslation();
  if (entitled !== false) return null;
  return (
    <p className={cn("text-muted-foreground flex items-start gap-2 text-sm leading-relaxed", className)}>
      <Lock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <span>{t("TestSeries.browseFreeNotice")}</span>
    </p>
  );
}

const dayFmt = (locale: string) =>
  new Intl.DateTimeFormat(locale === "hi" ? "hi-IN" : "en-IN", { day: "numeric", month: "short" });
const monthFmt = (locale: string) =>
  new Intl.DateTimeFormat(locale === "hi" ? "hi-IN" : "en-IN", { month: "long", year: "numeric" });

export function SeriesCalendar({
  entries,
  locale,
  entitled,
}: {
  entries: TestSeriesEntry[];
  locale: "en" | "hi";
  /** Max entitlement — `null` while still loading. See `SeriesStartButton`. */
  entitled: boolean | null;
}) {
  const { t } = useTranslation();
  const months = useMemo(() => {
    const out: { key: string; label: string; items: TestSeriesEntry[] }[] = [];
    const mf = monthFmt(locale);
    for (const e of entries) {
      const d = new Date(e.opens_at);
      const key = `${d.getUTCFullYear()}-${d.getUTCMonth()}`;
      const last = out[out.length - 1];
      if (last && last.key === key) last.items.push(e);
      else out.push({ key, label: mf.format(d), items: [e] });
    }
    return out;
  }, [entries, locale]);

  return (
    <div className="space-y-8">
      {months.map((m) => {
        const done = m.items.filter((e) => e.state === "submitted" || e.state === "submitted_late").length;
        return (
          <section key={m.key} aria-label={m.label}>
            <div className="mb-3 flex items-baseline justify-between gap-3">
              <h2 className="text-sm font-semibold tracking-wide uppercase">{m.label}</h2>
              <span className="text-muted-foreground text-xs">
                {t("TestSeries.completedOf", { done, total: m.items.length })}
              </span>
            </div>
            <ol className="space-y-3">
              {m.items.map((e) => (
                <li key={e.id}>
                  <EntryCard entry={e} locale={locale} entitled={entitled} />
                </li>
              ))}
            </ol>
          </section>
        );
      })}
    </div>
  );
}

function EntryCard({
  entry,
  locale,
  entitled,
}: {
  entry: TestSeriesEntry;
  locale: "en" | "hi";
  entitled: boolean | null;
}) {
  const { t } = useTranslation();
  const st = STATE[entry.state];
  const Icon = st.icon;
  const opensLabel = dayFmt(locale).format(new Date(entry.opens_at));
  const done = entry.state === "submitted" || entry.state === "submitted_late";

  return (
    <div className="bg-card border-border relative overflow-hidden rounded-xl border p-4 pl-5">
      {/* State rail — a second channel alongside the pill, never colour alone. */}
      <span className={cn("absolute inset-y-0 left-0 w-1", st.rail)} aria-hidden />

      {/* Title on its own row. At 390px a single flex-wrap row squeezes a long
          Hindi title to one visible character instead of wrapping — wrap moves
          whole items, and a flex-1 title shrinks before it wraps. */}
      <div className="flex items-start gap-3">
        <span className="bg-muted text-muted-foreground font-display flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm">
          {entry.sequence_no}
        </span>
        <h3 className="min-w-0 flex-1 text-base font-semibold">
          {entry.title_i18n ? entry.title_i18n[locale] : t("TestSeries.paperNumber", { n: entry.sequence_no })}
        </h3>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Pill className={st.pill}>
          <Icon className="h-3.5 w-3.5" aria-hidden />
          {t(st.key)}
        </Pill>
        <Pill className="bg-muted text-muted-foreground">
          <CalendarDays className="h-3.5 w-3.5" aria-hidden />
          {opensLabel}
        </Pill>
        {entry.question_count > 0 ? (
          <Pill className="bg-muted text-muted-foreground">
            {t("TestSeries.questionCount", { count: entry.question_count })}
          </Pill>
        ) : null}
        {entry.duration_minutes ? (
          <Pill className="bg-muted text-muted-foreground">
            {t("TestSeries.minutes", { count: entry.duration_minutes })}
          </Pill>
        ) : null}
        {done && entry.score != null && entry.total != null ? (
          <Pill className="bg-tulsi/15 text-tulsi-foreground">
            {entry.score} / {entry.total}
          </Pill>
        ) : null}
      </div>

      {entry.syllabus_note_i18n ? (
        <p className="text-muted-foreground mt-3 text-sm leading-relaxed">{entry.syllabus_note_i18n[locale]}</p>
      ) : null}

      {entry.sources_i18n ? (
        <p className="text-muted-foreground mt-2 flex gap-2 text-sm leading-relaxed">
          <BookOpen className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>
            <span className="text-foreground font-medium">{t("TestSeries.sourcesLabel")}: </span>
            {entry.sources_i18n[locale]}
          </span>
        </p>
      ) : null}

      <div className="mt-4">
        {entry.state === "scheduled" ? (
          <p className="text-muted-foreground text-sm">{t("TestSeries.scheduledExplainer", { date: opensLabel })}</p>
        ) : entry.state === "locked" ? (
          // States WHEN rather than offering a dead button. The server returns
          // 423 for the same case, so the two agree.
          <p className="text-muted-foreground text-sm">{t("TestSeries.opensOn", { date: opensLabel })}</p>
        ) : done && entry.attempt_id ? (
          // DELIBERATELY UNGATED. A paper you already sat is your own result;
          // `getAttemptResult` applies no series gate either, so a plan that
          // lapses must not retroactively hide work you already did.
          <Button asChild variant="outline" className="min-h-11">
            <Link to={`/${locale}/practice/attempt/${entry.attempt_id}/result`}>{t("TestSeries.viewResult")}</Link>
          </Button>
        ) : entry.test_id ? (
          <SeriesStartButton
            testId={entry.test_id}
            locale={locale}
            resume={entry.state === "in_progress"}
            entitled={entitled}
          />
        ) : null}
      </div>
    </div>
  );
}
