import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router";
import { BrainCircuit, ChevronRight, Clock, Loader2, Newspaper, Sparkles } from "lucide-react";
import type { DashboardToday, TestSummary } from "@neev/shared";
import { SectionCard } from "@/components/ui-x/section-card";
import { useEnsureTodayQuiz } from "@/hooks/use-daily";
import { useLocale } from "@/hooks/use-locale";

function TodayRow({
  icon: Icon,
  label,
  to,
  cta,
  onClick,
  pending,
}: {
  icon: typeof Clock;
  label: string;
  to?: string;
  cta?: string;
  onClick?: () => void;
  pending?: boolean;
}) {
  const row = (
    <div className="flex min-h-11 items-center gap-3 rounded-lg px-2">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
        {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Icon className="size-4" aria-hidden />}
      </span>
      <span className="flex-1 text-sm">{label}</span>
      {(to || onClick) && cta && (
        <span className="flex shrink-0 items-center gap-1 text-sm font-medium text-primary">
          {cta}
          <ChevronRight className="size-4" aria-hidden />
        </span>
      )}
    </div>
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        className="w-full rounded-lg text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-70"
      >
        {row}
      </button>
    );
  }

  if (!to) return row;
  return (
    <Link
      to={to}
      className="rounded-lg transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {row}
    </Link>
  );
}

export function TodayCard({ data }: { data: DashboardToday }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const navigate = useNavigate();
  const ensureTodayQuiz = useEnsureTodayQuiz();

  /** Generate both quizzes, then jump into the one this row is for (or GS if it wasn't the target). */
  function handleGenerateQuiz(target: "gs" | "csat") {
    ensureTodayQuiz.mutate(undefined, {
      onSuccess: (quizzes) => {
        // A `null` variant means there were genuinely no questions to build from
        // yet — dashboardSummary is still invalidated, so the row settles back to
        // its empty state on refetch. Prefer the row's own target, fall back to GS.
        const quiz = quizzes[target] ?? quizzes.gs ?? quizzes.csat;
        if (quiz) navigate(`/${locale}/practice/test/${quiz.id}`);
      },
    });
  }

  /** One daily-quiz row (GS or CSAT) — links into the quiz, or self-heal-generates it. */
  function QuizRow({
    quiz,
    paper,
    icon,
    shortLabel,
  }: {
    quiz: TestSummary | null;
    paper: "gs" | "csat";
    icon: typeof Sparkles;
    shortLabel: string;
  }) {
    const label = quiz
      ? shortLabel
      : ensureTodayQuiz.isPending
        ? t("Dashboard.todayDailyQuizGenerating")
        : ensureTodayQuiz.isError
          ? t("Dashboard.todayDailyQuizError")
          : ensureTodayQuiz.isSuccess
            ? t("Dashboard.todayDailyQuizEmpty")
            : t("Dashboard.todayDailyQuizNone");
    return (
      <TodayRow
        icon={icon}
        label={label}
        to={quiz ? `/${locale}/practice/test/${quiz.id}` : undefined}
        onClick={quiz ? undefined : () => handleGenerateQuiz(paper)}
        pending={!quiz && ensureTodayQuiz.isPending}
        cta={
          quiz
            ? t("Dashboard.todayDailyQuizStartCta")
            : ensureTodayQuiz.isPending
              ? undefined
              : t("Dashboard.todayDailyQuizGenerateCta")
        }
      />
    );
  }

  return (
    <SectionCard title={t("Dashboard.todayTitle")}>
      <div className="flex flex-col gap-1">
        <TodayRow
          icon={Clock}
          label={
            data.srs_due_count > 0
              ? t("Dashboard.todaySrsDue", { count: data.srs_due_count })
              : t("Dashboard.todaySrsNone")
          }
          to={`/${locale}/revision`}
          cta={t("Dashboard.todayGoToRevision")}
        />
        <TodayRow
          icon={Newspaper}
          label={
            data.current_affairs_today_count > 0
              ? t("Dashboard.todayCurrentAffairs", { count: data.current_affairs_today_count })
              : t("Dashboard.todayCurrentAffairsNone")
          }
          to={`/${locale}/current-affairs`}
          cta={t("Dashboard.todayGoToCurrentAffairs")}
        />
        <QuizRow quiz={data.daily_quiz_gs} paper="gs" icon={Sparkles} shortLabel={t("Dashboard.todayDailyQuizGs")} />
        <QuizRow
          quiz={data.daily_quiz_csat}
          paper="csat"
          icon={BrainCircuit}
          shortLabel={t("Dashboard.todayDailyQuizCsat")}
        />
      </div>
    </SectionCard>
  );
}
