import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { BookOpen, Check, Layers, PenLine, Sparkles } from "lucide-react";
import type { DashboardChecklistItem, DashboardContinue, DashboardToday, Locale } from "@neev/shared";
import { SectionCard } from "@/components/ui-x/section-card";
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
      // The single "Daily quiz" habit ticks when EITHER quiz is done; point the
      // still-actionable link at the GS quiz (primary), falling back to the
      // Daily Quiz tab (which shows both) when it hasn't been built yet.
      return today.daily_quiz_gs ? `/${locale}/practice/test/${today.daily_quiz_gs.id}` : `/${locale}/practice?tab=daily`;
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
      className="flex min-h-11 items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span
        className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-xl",
          item.done ? "bg-tulsi/15 text-tulsi-foreground" : "bg-primary/10 text-primary",
        )}
      >
        <Icon className="size-4" aria-hidden />
      </span>
      <span className={cn("min-w-0 flex-1 text-sm", item.done && "text-muted-foreground line-through")}>
        {t(`Dashboard.guidedItem_${item.key}`)}
      </span>
      {progress && (
        <span className={cn("shrink-0 text-xs font-medium tabular-nums", item.done ? "text-tulsi-foreground" : "text-muted-foreground")}>
          {progress}
        </span>
      )}
      {/* The reference's Today's Plan puts a real checkbox at the end of each
          row — filled --action with a tick when done, an empty ring when not.
          Presentational only: the row is a Link, the item completes by doing
          the work, so this must not read to a screen reader as a control. */}
      <span
        aria-hidden
        className={cn(
          "flex size-6 shrink-0 items-center justify-center rounded-md border-2 transition-colors",
          item.done
            ? "border-action bg-action text-action-foreground"
            : "border-border text-transparent",
        )}
      >
        <Check className="size-4" strokeWidth={3} />
      </span>
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
    // The progress ring that used to head this card now leads the stat strip
    // above it (see stat-strip.tsx) — the reference's Today's Plan is a pure
    // checklist, and two rings showing one fraction on one screen read as a bug.
    <SectionCard
      title={t("Dashboard.guidedTitle")}
      description={allDone ? t("Dashboard.guidedAllDone") : t("Dashboard.guidedSubtitle")}
      className="border-primary/20"
    >
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
