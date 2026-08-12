import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation } from "react-router";
import { AlertTriangle, CalendarRange, ListChecks, PenLine, Sunrise } from "lucide-react";
import type { TestSummary } from "@neev/shared";
import { useDailyCaSets, useWeeklyCaSets } from "@/hooks/use-current-affairs";
import { useLocale } from "@/hooks/use-locale";
import { istToday, istWeekStart, shiftDate } from "@/lib/ist";
import { cn } from "@/lib/utils";

/**
 * The current-affairs practice entry points, at both cadences.
 *
 * THE DESIGN PROBLEM this solves: four buttons named "Prelims quiz" and "Mains
 * practice" twice over read as one repeated list, so a student cannot tell what
 * the second pair is FOR. Three axes are therefore encoded separately, and none
 * of them is the button label:
 *
 *   CADENCE  -> its own bordered panel, with an icon, a title, and one line of
 *               copy saying what that sitting is. Not a bare uppercase label.
 *   SCALE    -> the question count as a display numeral (Inter 800, tabular),
 *               so "5" vs "20" is legible at a glance. This is the honest
 *               distinguisher: the daily set is a quick hit, the weekly one is
 *               the substantial sitting (caps 15/5 vs 50/20 in ca/assemble.ts).
 *   TYPE     -> colour + icon, unchanged and consistent across both panels
 *               (primary/ListChecks = prelims MCQs, marigold/PenLine = mains
 *               descriptive), so the pairing a user already knows still holds.
 *
 * Empty state is per cadence and per type: one can be ready while the other is
 * not, so a missing set says so in words rather than rendering a dead pill.
 */

interface Cadence {
  icon: ReactNode;
  title: string;
  blurb: string;
  /** When the next set of this cadence lands. Shown so an empty panel is a promise, not a dead end. */
  refresh: string;
  prelims: TestSummary | null | undefined;
  mains: TestSummary | null | undefined;
  isLoading: boolean;
  /**
   * A FAILED fetch, which must never render as an empty set. `data` is
   * undefined in both states, so without this a rate limit or a 5xx tells the
   * student "nothing new today" — see ui-x/query-error-state.tsx, whose own
   * docstring records this exact bug shipping twice before, once on this very
   * page. Observed live here too: a 429 during verification rendered the weekly
   * panel as empty.
   */
  isError: boolean;
  retry: () => void;
  emptyPrelims: string;
  emptyMains: string;
  /** Shown INSTEAD of two placeholder slots when neither set exists. */
  emptyBoth: string;
}

function ActionButton({
  to,
  icon,
  label,
  count,
  tone,
}: {
  to: string;
  icon: ReactNode;
  label: string;
  count: number;
  tone: "prelims" | "mains";
}) {
  const { t } = useTranslation();
  return (
    <Link
      to={to}
      className={cn(
        // h-11 = 44px, the tap-target floor.
        "group inline-flex h-11 flex-1 items-center justify-between gap-2 rounded-[10px] px-3.5",
        "text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card",
        tone === "prelims"
          ? "bg-primary text-primary-foreground hover:bg-primary/90"
          : "bg-marigold text-brand-navy hover:bg-marigold/90",
      )}
    >
      <span className="inline-flex min-w-0 items-center gap-2">
        {icon}
        <span className="truncate">{label}</span>
      </span>
      <span className="inline-flex shrink-0 items-baseline gap-1">
        {/* Display numeral: the one thing that makes 15-vs-50 readable at a glance.
            NOT `leading-none` — at text-base that gives a 16px line box for glyphs
            measuring 18px, so a two-digit count overflows its own box. Nothing is
            visibly cut today (the span is overflow-visible) but it would be the
            instant any ancestor gained overflow-hidden. Baseline alignment is
            unaffected: `items-baseline` positions by baseline, not box height. */}
        <span className="font-extrabold tabular-nums tracking-[-0.02em] text-base leading-tight">{count}</span>
        <span className="text-[11px] font-medium opacity-80">{t("CurrentAffairs.setQuestionUnit")}</span>
      </span>
    </Link>
  );
}

/**
 * `min-h-11`, never a fixed `h-11`: this text is longer than a button label and
 * is far longer in Devanagari, so a fixed height clipped it the moment it wrapped
 * — which is the state a real user sees whenever supply pauses. The slot grows
 * instead. Copy names only the TYPE; the panel heading already says the cadence.
 */
function EmptySlot({ icon, text }: { icon: ReactNode; text: string }) {
  return (
    <span className="inline-flex min-h-11 flex-1 items-center gap-2 rounded-[10px] border border-dashed border-border px-3.5 py-2 text-sm text-muted-foreground">
      {icon}
      <span className="min-w-0 leading-[1.75]">{text}</span>
    </span>
  );
}

function CadencePanel({ cadence }: { cadence: Cadence }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const location = useLocation();
  // Return exactly here (preserving the CA page's lens/category filters) when a
  // quiz is cancelled, instead of the generic Practice/Answers list.
  const from = encodeURIComponent(location.pathname + location.search);

  const prelimsIcon = <ListChecks className="size-4 shrink-0" aria-hidden />;
  const mainsIcon = <PenLine className="size-4 shrink-0" aria-hidden />;
  // Two dashed placeholders side by side is a lot of furniture for "nothing
  // here yet" — and it is the state a whole cadence sits in whenever the supply
  // pipeline pauses. One sentence, paired with the refresh line below, says the
  // same thing without pretending there are two absent things to look at.
  const bothEmpty = !cadence.prelims && !cadence.mains;

  return (
    <div className="flex min-w-0 flex-col gap-3 rounded-xl border border-border bg-background/60 p-4">
      <div className="flex min-w-0 flex-col gap-1">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <span className="text-muted-foreground">{cadence.icon}</span>
          {cadence.title}
        </h3>
        <p className="text-xs leading-[1.75] text-muted-foreground">{cadence.blurb}</p>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        {cadence.isLoading ? (
          <>
            <span className="h-11 flex-1 animate-pulse rounded-[10px] bg-muted" aria-hidden />
            <span className="h-11 flex-1 animate-pulse rounded-[10px] bg-muted" aria-hidden />
            <span className="sr-only">{t("CurrentAffairs.weeklyLoading")}</span>
          </>
        ) : cadence.isError ? (
          // Compact rather than the full-page QueryErrorState (px-6 py-12,
          // centred): this replaces a two-button row inside a half-width panel,
          // and that component's block would dwarf its sibling. It keeps the
          // parts that matter — coral so it does not read as an empty state,
          // role="alert", and a retry — and reuses the shared copy.
          <div role="alert" className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-[10px] border border-coral/30 bg-coral/5 px-3 py-2">
            <AlertTriangle className="size-4 shrink-0 text-coral" aria-hidden />
            <span className="text-sm leading-[1.75] text-foreground">{t("Common.loadErrorTitle")}</span>
            <button
              type="button"
              onClick={cadence.retry}
              className="rounded-md text-sm font-semibold text-coral underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {t("Common.retry")}
            </button>
          </div>
        ) : bothEmpty ? (
          <p className="text-sm leading-[1.75] text-muted-foreground">{cadence.emptyBoth}</p>
        ) : (
          <>
            {cadence.prelims ? (
              <ActionButton
                to={`/${locale}/practice/test/${cadence.prelims.id}?from=${from}`}
                icon={prelimsIcon}
                label={t("CurrentAffairs.prelimsQuizButton")}
                count={cadence.prelims.question_count}
                tone="prelims"
              />
            ) : (
              <EmptySlot icon={prelimsIcon} text={cadence.emptyPrelims} />
            )}
            {cadence.mains ? (
              <ActionButton
                to={`/${locale}/answers/session/${cadence.mains.id}?from=${from}`}
                icon={mainsIcon}
                label={t("CurrentAffairs.mainsPracticeButton")}
                count={cadence.mains.question_count}
                tone="mains"
              />
            ) : (
              <EmptySlot icon={mainsIcon} text={cadence.emptyMains} />
            )}
          </>
        )}
      </div>

      {/* The refresh promise. Load-bearing in the empty state: without it a
          missing set reads as "broken" rather than "not yet". */}
      {/* Suppressed on error: "the next one lands X" is derived from whether
          THIS week's set exists, which a failed fetch cannot tell us. */}
      {!cadence.isLoading && !cadence.isError && (
        <p className="text-[11px] leading-[1.75] text-muted-foreground">{cadence.refresh}</p>
      )}
    </div>
  );
}

/**
 * Both cadences, side by side on desktop and stacked on mobile. They are
 * separate queries because they are built by separate crons — either can be
 * ready while the other is not.
 */
/**
 * The DAILY cadence on its own, exported so Practice → Daily can render the
 * day's current-affairs sets beside the day's syllabus quizzes without
 * duplicating this panel.
 *
 * Extracted rather than copied precisely because the CA page keeps its own
 * copy of it: two renderings of the same sets would otherwise drift in empty
 * state, error handling and the refresh promise — the three things this panel
 * exists to get right. Both call sites read the same `useDailyCaSets` cache
 * entry, so the second rendering costs no extra request.
 */
export function DailyCaSetsPanel() {
  const { t } = useTranslation();
  const daily = useDailyCaSets();

  return (
    <CadencePanel
      cadence={{
        icon: <Sunrise className="size-4" aria-hidden />,
        title: t("CurrentAffairs.dailySetsLabel"),
        blurb: t("CurrentAffairs.dailySetsBlurb"),
        refresh: t("CurrentAffairs.dailyRefreshHint"),
        prelims: daily.data?.prelims,
        mains: daily.data?.mains,
        isLoading: daily.isLoading,
        isError: daily.isError,
        retry: () => void daily.refetch(),
        emptyPrelims: t("CurrentAffairs.dailyEmptyPrelims"),
        emptyMains: t("CurrentAffairs.dailyEmptyMains"),
        emptyBoth: t("CurrentAffairs.dailyEmptyBoth"),
      }}
    />
  );
}

export function CurrentAffairsQuizSets() {
  const { t } = useTranslation();
  const locale = useLocale();
  const weekly = useWeeklyCaSets();

  // When the next weekly set lands. The weekly assembly is Monday-anchored and
  // its cron runs Monday (ca/assemble.ts, .github/workflows/ca-assemble.yml),
  // so this is a real promise rather than a guess. If this week's set is
  // already here the next one is next Monday; if it is missing it is due on the
  // coming Monday -- which is TODAY when today is a Monday and the cron has not
  // run yet, so that case must not say "in 7 days".
  const today = istToday();
  const thisMonday = istWeekStart(today);
  const hasWeekly = !!(weekly.data?.prelims || weekly.data?.mains);
  const nextWeeklyDate = hasWeekly || today !== thisMonday ? shiftDate(thisMonday, 7) : today;
  const nextWeeklyLabel = new Date(`${nextWeeklyDate}T00:00:00Z`).toLocaleDateString(locale, {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });

  const cadences: Cadence[] = [
    {
      icon: <CalendarRange className="size-4" aria-hidden />,
      title: t("CurrentAffairs.weeklySetsLabel"),
      blurb: t("CurrentAffairs.weeklySetsBlurb"),
      refresh: t(hasWeekly ? "CurrentAffairs.weeklyRefreshHint" : "CurrentAffairs.weeklyDueHint", {
        date: nextWeeklyLabel,
      }),
      prelims: weekly.data?.prelims,
      mains: weekly.data?.mains,
      isLoading: weekly.isLoading,
      isError: weekly.isError,
      retry: () => void weekly.refetch(),
      emptyPrelims: t("CurrentAffairs.weeklyEmptyPrelims"),
      emptyMains: t("CurrentAffairs.weeklyEmptyMains"),
      emptyBoth: t("CurrentAffairs.weeklyEmptyBoth"),
    },
  ];

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <DailyCaSetsPanel />
      {cadences.map((c) => (
        <CadencePanel key={c.title} cadence={c} />
      ))}
    </div>
  );
}
