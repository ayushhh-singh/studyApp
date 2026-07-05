import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { ChevronRight, Clock, Newspaper, Sparkles } from "lucide-react";
import type { DashboardToday } from "@prayasup/shared";
import { SectionCard } from "@/components/ui-x/section-card";
import { useLocale } from "@/hooks/use-locale";

function TodayRow({
  icon: Icon,
  label,
  to,
  cta,
}: {
  icon: typeof Clock;
  label: string;
  to?: string;
  cta?: string;
}) {
  const row = (
    <div className="flex min-h-11 items-center gap-3 rounded-lg px-2">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
        <Icon className="size-4" aria-hidden />
      </span>
      <span className="flex-1 text-sm">{label}</span>
      {to && cta && (
        <span className="flex shrink-0 items-center gap-1 text-sm font-medium text-primary">
          {cta}
          <ChevronRight className="size-4" aria-hidden />
        </span>
      )}
    </div>
  );

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
          label={data.daily_quiz ? data.daily_quiz.title_i18n[locale] : t("Dashboard.todayDailyQuizNone")}
          to={data.daily_quiz ? `/${locale}/practice/test/${data.daily_quiz.id}` : undefined}
          cta={data.daily_quiz ? t("Dashboard.todayDailyQuizCta") : undefined}
        />
      </div>
    </SectionCard>
  );
}
