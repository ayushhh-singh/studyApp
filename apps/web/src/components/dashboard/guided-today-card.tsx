import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { BookOpen, CheckCircle2, ChevronRight, Layers, PenLine, Sparkles } from "lucide-react";
import type { DashboardChecklistItem, DashboardContinue, DashboardToday, Locale } from "@prayasup/shared";
import { SectionCard } from "@/components/ui-x/section-card";
import { ProgressRing } from "@/components/ui-x/progress-ring";
import { cn } from "@/lib/utils";

const ICONS: Record<DashboardChecklistItem["key"], typeof Sparkles> = {
  daily_quiz: Sparkles,
  answer_set: PenLine,
  revision: Layers,
  continue_reading: BookOpen,
};

/** Where each checklist item takes the user. */
function itemLink(
  key: DashboardChecklistItem["key"],
  locale: Locale,
  today: DashboardToday,
  cont: DashboardContinue,
): string {
  switch (key) {
    case "daily_quiz":
      return today.daily_quiz ? `/${locale}/practice/test/${today.daily_quiz.id}` : `/${locale}/practice?tab=daily`;
    case "answer_set":
      return `/${locale}/answers`;
    case "revision":
      return `/${locale}/revision`;
    case "continue_reading":
      return cont.type === "syllabus_node"
        ? `/${locale}/learn/${cont.paper_code}/${cont.syllabus_node_id}`
        : `/${locale}/learn`;
  }
}

/** The sub-label showing progress toward a multi-step item. */
function itemProgress(item: DashboardChecklistItem, today: DashboardToday, t: (k: string, o?: Record<string, unknown>) => string): string | null {
  if (item.done) return t("Dashboard.guidedDone");
  if (item.key === "answer_set") return t("Dashboard.guidedCount", { current: item.current, target: item.target });
  if (item.key === "revision" && today.srs_due_count > 0) return t("Dashboard.guidedSrsDue", { n: today.srs_due_count });
  return null;
}

function ChecklistRow({
  item,
  to,
  progress,
}: {
  item: DashboardChecklistItem;
  to: string;
  progress: string | null;
}) {
  const { t } = useTranslation();
  const Icon = ICONS[item.key];
  return (
    <Link
      to={to}
      className="flex min-h-11 items-center gap-3 rounded-lg px-2 py-1.5 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span
        className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-full",
          item.done ? "bg-tulsi/15 text-tulsi" : "bg-primary/10 text-primary",
        )}
      >
        {item.done ? <CheckCircle2 className="size-4" aria-hidden /> : <Icon className="size-4" aria-hidden />}
      </span>
      <span className={cn("flex-1 text-sm", item.done && "text-muted-foreground line-through")}>
        {t(`Dashboard.guidedItem_${item.key}`)}
      </span>
      {progress && (
        <span className={cn("shrink-0 text-xs font-medium tabular-nums", item.done ? "text-tulsi" : "text-muted-foreground")}>
          {progress}
        </span>
      )}
      {!item.done && <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />}
    </Link>
  );
}

export function GuidedTodayCard({
  today,
  cont,
  locale,
}: {
  today: DashboardToday;
  cont: DashboardContinue;
  locale: Locale;
}) {
  const { t } = useTranslation();
  const allDone = today.checklist_total > 0 && today.checklist_completed >= today.checklist_total;

  return (
    <SectionCard className="border-primary/20">
      <div className="flex items-center gap-4">
        <ProgressRing value={today.checklist_completed} max={today.checklist_total}>
          {today.checklist_completed}/{today.checklist_total}
        </ProgressRing>
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 className="text-base font-semibold">{t("Dashboard.guidedTitle")}</h2>
          <p className="text-sm text-muted-foreground">
            {allDone ? t("Dashboard.guidedAllDone") : t("Dashboard.guidedSubtitle")}
          </p>
        </div>
      </div>
      <div className="flex flex-col gap-0.5">
        {today.checklist.map((item) => (
          <ChecklistRow
            key={item.key}
            item={item}
            to={itemLink(item.key, locale, today, cont)}
            progress={itemProgress(item, today, t)}
          />
        ))}
      </div>
    </SectionCard>
  );
}
