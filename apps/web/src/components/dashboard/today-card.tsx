import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router";
import { ChevronRight, Clock, Loader2, Newspaper, Sparkles } from "lucide-react";
import type { DashboardToday } from "@neev/shared";
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

  function handleGenerateQuiz() {
    ensureTodayQuiz.mutate(undefined, {
      onSuccess: (test) => {
        // A `null` result means there were genuinely no questions to build
        // from yet — dashboardSummary is still invalidated, so the row will
        // settle back to its normal empty state on refetch.
        if (test) navigate(`/${locale}/practice/test/${test.id}`);
      },
    });
  }

  const dailyQuizLabel = data.daily_quiz
    ? data.daily_quiz.title_i18n[locale]
    : ensureTodayQuiz.isPending
      ? t("Dashboard.todayDailyQuizGenerating")
      : ensureTodayQuiz.isError
        ? t("Dashboard.todayDailyQuizError")
        : ensureTodayQuiz.isSuccess
          ? t("Dashboard.todayDailyQuizEmpty")
          : t("Dashboard.todayDailyQuizNone");

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
        <TodayRow
          icon={Sparkles}
          label={dailyQuizLabel}
          to={data.daily_quiz ? `/${locale}/practice/test/${data.daily_quiz.id}` : undefined}
          onClick={data.daily_quiz ? undefined : handleGenerateQuiz}
          pending={!data.daily_quiz && ensureTodayQuiz.isPending}
          cta={
            data.daily_quiz
              ? t("Dashboard.todayDailyQuizCta")
              : ensureTodayQuiz.isPending
                ? undefined
                : t("Dashboard.todayDailyQuizGenerateCta")
          }
        />
      </div>
    </SectionCard>
  );
}
