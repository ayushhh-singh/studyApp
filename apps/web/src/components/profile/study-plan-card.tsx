import { useState } from "react";
import { useTranslation } from "react-i18next";
import { BookOpen, Brain, CalendarRange, ClipboardList, NotebookPen, PenSquare } from "lucide-react";
import type { PlanDay, PlanTask, PlanTaskKind } from "@prayasup/shared";
import { SectionCard } from "@/components/ui-x/section-card";
import { Skeleton } from "@/components/ui-x/skeleton";
import { EmptyState } from "@/components/ui-x/empty-state";
import { Button } from "@/components/ui/button";
import { useActivePlan, useToggleTask } from "@/hooks/use-study-plan";
import { useStudyPlanStream } from "@/hooks/use-study-plan-stream";
import { useLocale } from "@/hooks/use-locale";
import { cn } from "@/lib/utils";

const KIND_ICON: Record<PlanTaskKind, typeof BookOpen> = {
  read: BookOpen,
  practice: PenSquare,
  revise: Brain,
  write: NotebookPen,
  mock: ClipboardList,
};

const DEFAULT_HOURS = 3;

function TaskRow({ task, date }: { task: PlanTask; date: string }) {
  const locale = useLocale();
  const toggleTask = useToggleTask();
  const Icon = KIND_ICON[task.kind];

  return (
    <label
      className={cn(
        "flex min-h-11 cursor-pointer items-center gap-2.5 rounded-lg border border-border bg-card px-3 py-2 text-sm transition-colors hover:bg-muted/50",
        task.done && "opacity-60",
      )}
    >
      <input
        type="checkbox"
        checked={task.done}
        disabled={toggleTask.isPending}
        onChange={(e) => toggleTask.mutate({ date, task_id: task.id, done: e.target.checked })}
        className="size-4 shrink-0 accent-primary"
      />
      <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      <span className={cn("flex-1", task.done && "line-through")} lang={locale}>
        {task.title_i18n[locale]}
      </span>
      <span className="shrink-0 text-xs text-muted-foreground">{task.duration_min}m</span>
    </label>
  );
}

function PlanDayCard({ day }: { day: PlanDay }) {
  const locale = useLocale();
  const doneCount = day.tasks.filter((t) => t.done).length;

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-card/50 p-3">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-semibold" lang={locale}>
          {day.day_label_i18n[locale]}
        </span>
        <span className="text-xs text-muted-foreground">
          {doneCount}/{day.tasks.length}
        </span>
      </div>
      <p className="text-xs text-muted-foreground" lang={locale}>
        {day.focus_i18n[locale]}
      </p>
      <div className="flex flex-col gap-1.5">
        {day.tasks.map((task) => (
          <TaskRow key={task.id} task={task} date={day.date} />
        ))}
      </div>
    </div>
  );
}

export function StudyPlanCard() {
  const { t } = useTranslation();
  const { data, isLoading } = useActivePlan();
  const stream = useStudyPlanStream();
  const [hours, setHours] = useState(DEFAULT_HOURS);

  const plan = data?.plan ?? stream.plan;
  const canRegenerate = data?.can_regenerate_today ?? true;

  function generate() {
    stream.start(hours);
  }

  return (
    <SectionCard title={t("StudyPlan.title")} description={t("StudyPlan.description")}>
      {isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1.5 text-sm font-medium">
              {t("StudyPlan.hoursPerDay")}
              <input
                type="number"
                min={0.5}
                max={16}
                step={0.5}
                value={hours}
                onChange={(e) => setHours(Number(e.target.value))}
                className="min-h-10 w-28 rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </label>
            <Button
              type="button"
              onClick={generate}
              disabled={stream.isStreaming || (!!plan && !canRegenerate)}
              title={!!plan && !canRegenerate ? t("StudyPlan.regenerateCooldown") : undefined}
            >
              {stream.isStreaming
                ? t("StudyPlan.generating")
                : plan
                  ? t("StudyPlan.regenerate")
                  : t("StudyPlan.generate")}
            </Button>
          </div>

          {!!plan && !canRegenerate && (
            <p className="text-xs text-muted-foreground">{t("StudyPlan.regenerateCooldown")}</p>
          )}

          {stream.isStreaming && (
            <p className="text-sm text-muted-foreground">
              {t("StudyPlan.statusGenerating", { stage: stream.stage ?? "" })}
            </p>
          )}
          {stream.error && <p className="text-sm text-destructive">{stream.error}</p>}

          {!plan && !stream.isStreaming ? (
            <EmptyState
              icon={CalendarRange}
              title={t("StudyPlan.emptyTitle")}
              description={t("StudyPlan.emptyDescription")}
            />
          ) : plan ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {plan.days.map((day) => (
                <PlanDayCard key={day.date} day={day} />
              ))}
            </div>
          ) : null}
        </div>
      )}
    </SectionCard>
  );
}
