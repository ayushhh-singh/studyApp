import { ChevronDown } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { useLocale } from "@/hooks/use-locale";
import { useProfile } from "@/hooks/use-profile";
import { useExams } from "@/hooks/use-exams";
import { shortExamName } from "@/lib/exam-label";
import { cn } from "@/lib/utils";

/**
 * The exam-switcher SLOT in the top bar — which exam you are preparing for,
 * always visible, on every viewport.
 *
 * Placement was a product decision, not an inference: exam scope changes what
 * nearly every screen contains (papers, mocks, boards, current affairs,
 * chapters), so it belongs where it can be read at a glance rather than behind
 * the avatar menu.
 *
 * DESIGNED SLOT ONLY. Tapping it routes to the existing, fully-built
 * ExamSwitcherCard in Profile (which owns the confirmation dialog explaining
 * what does and doesn't carry over, plus the cache clear). It deliberately
 * does NOT open its own picker — a real in-place switcher is Session 10's
 * work, and shipping a second half-built one here would leave two paths that
 * can disagree.
 *
 * Renders nothing until the exam registry resolves, and nothing at all if only
 * one exam is selectable — a "switcher" with nothing to switch to is noise.
 */
export function ExamSwitcherChip({ className }: { className?: string }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const navigate = useNavigate();
  const { data: profile } = useProfile();
  const { data: exams } = useExams();

  const selectable = exams?.filter((e) => e.is_live) ?? [];
  const current = exams?.find((e) => e.exam_code === profile?.target_exam);
  if (!current || selectable.length < 2) return null;
  const name = shortExamName(current, locale, profile?.target_exam);

  return (
    <button
      type="button"
      onClick={() => navigate(`/${locale}/profile`)}
      title={t("TopBar.examSwitcherHint")}
      className={cn(
        "inline-flex min-h-9 shrink-0 items-center gap-1 rounded-full border border-border bg-secondary px-2 text-xs font-semibold text-secondary-foreground transition-colors hover:bg-secondary/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:px-2.5",
        className,
      )}
    >
      {/* The visible label is the LATIN code in both locales, and the chevron
          is desktop-only. Both are width decisions, measured: this row also
          carries the page title and six icon controls, and the title has a
          documented ~8-character floor at 320px (see TopBar). The Hindi short
          name is 10 Devanagari characters ("यूपीपीएससी") against 5 in Latin —
          rendering it here pushed the Hindi title down to ~4 characters.
          Latin-in-both-locales for a compact abbreviation is this app's own
          established convention (hooks/use-paper-catalog.ts's `latinLabel`,
          lib/exam-label.ts's `stateFocusCode`).

          The full localized name goes to screen readers instead, along with
          the fact that this is a switcher — shortExamName() rather than the
          registry's formal "UPPSC (UP PCS)", which is a picker label. */}
      <span className="sr-only">{t("TopBar.examSwitcherLabel", { exam: name })}</span>
      <span aria-hidden>{current.exam_code.toUpperCase()}</span>
      <ChevronDown className="hidden size-3 opacity-70 sm:block" aria-hidden />
    </button>
  );
}
