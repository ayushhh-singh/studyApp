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
        "inline-flex min-h-8 shrink-0 items-center gap-1 rounded-full border border-border bg-secondary px-2.5 text-xs font-semibold text-secondary-foreground transition-colors hover:bg-secondary/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
    >
      {/* shortExamName, not display_name_i18n: the registry's formal name is
          "UPPSC (UP PCS)", which is right for a picker and far too wide for a
          row that at 390px also carries the page title and six icon controls.
          `sr-only` keeps the fact that this is a switcher available to screen
          readers, since the visible text is only the exam's short name. */}
      <span className="sr-only">{t("TopBar.examSwitcherLabel", { exam: name })}</span>
      <span aria-hidden>{name}</span>
      <ChevronDown className="size-3 opacity-70" aria-hidden />
    </button>
  );
}
