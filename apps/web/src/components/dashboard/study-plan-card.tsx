import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  BookOpen,
  Brain,
  CalendarRange,
  CheckCircle2,
  ChevronDown,
  ClipboardList,
  NotebookPen,
  PartyPopper,
  PenSquare,
  Trash2,
} from "lucide-react";
import type { PlanDay, PlanTask, PlanTaskKind } from "@neev/shared";
import { SectionCard } from "@/components/ui-x/section-card";
import { useAuth } from "@/providers/auth-provider";
import { usePaywallStore } from "@/stores/paywall-store";
import { ProgressRing } from "@/components/ui-x/progress-ring";
import { Skeleton } from "@/components/ui-x/skeleton";
import { EmptyState } from "@/components/ui-x/empty-state";
import { Button } from "@/components/ui/button";
import { useActivePlan, useDeleteDay, useDeleteTask, useToggleTask } from "@/hooks/use-study-plan";
import { useStudyPlanStream } from "@/hooks/use-study-plan-stream";
import { useLocale } from "@/hooks/use-locale";
import { istToday } from "@/lib/ist";
import { scoreBandColor } from "@/lib/score-band";
import { cn } from "@/lib/utils";

const KIND_ICON: Record<PlanTaskKind, typeof BookOpen> = {
  read: BookOpen,
  practice: PenSquare,
  revise: Brain,
  write: NotebookPen,
  mock: ClipboardList,
};

const DEFAULT_HOURS = 3;

/** Single-tap delete — no arm-then-confirm step. A plan day/task is low-stakes
    (the whole week can always be regenerated), and the two-step confirm sat
    right next to the collapse toggle, easy to mis-tap and easy to mistake for
    "delete isn't working" when it only armed instead of deleting. */
function DeleteButton({
  onConfirm,
  ariaLabel,
  pending,
}: {
  onConfirm: () => void;
  ariaLabel: string;
  pending?: boolean;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label={ariaLabel}
      disabled={pending}
      onClick={onConfirm}
      className="text-muted-foreground hover:text-coral"
    >
      <Trash2 className="size-3.5" aria-hidden />
    </Button>
  );
}

/** The task-kind icon, swapping to a filled tulsi check (with a small pop) the moment it's done — same chip language as dashboard/guided-today-card.tsx. */
function TaskChip({ done, Icon }: { done: boolean; Icon: typeof BookOpen }) {
  const reduce = useReducedMotion();
  return (
    <span
      className={cn(
        "flex size-8 shrink-0 items-center justify-center rounded-full transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-ring",
        done ? "bg-tulsi/15 text-tulsi-foreground" : "bg-primary/10 text-primary",
      )}
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={done ? "done" : "pending"}
          initial={reduce ? undefined : { scale: 0.4, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={reduce ? undefined : { scale: 0.4, opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="flex items-center justify-center"
        >
          {done ? <CheckCircle2 className="size-4" aria-hidden /> : <Icon className="size-4" aria-hidden />}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

function TaskRow({ task, date }: { task: PlanTask; date: string }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const toggleTask = useToggleTask();
  const deleteTask = useDeleteTask();
  const Icon = KIND_ICON[task.kind];

  return (
    <motion.div
      layout="position"
      initial={false}
      exit={{ opacity: 0, height: 0, marginBottom: 0 }}
      transition={{ duration: 0.2 }}
      className="flex min-w-0 flex-col gap-1 rounded-lg border border-border bg-card px-3 py-2 transition-colors"
    >
      {/* Row 1: checkbox + icon chip + title. The title wraps to 2 lines
          (line-clamp-2) rather than hard-truncating, so a long task name is
          actually readable instead of ending in "…". */}
      <label className="flex min-h-11 min-w-0 cursor-pointer items-start gap-2.5 py-1 text-sm">
        <input
          type="checkbox"
          checked={task.done}
          disabled={toggleTask.isPending}
          onChange={(e) => toggleTask.mutate({ date, task_id: task.id, done: e.target.checked })}
          className="peer sr-only"
        />
        <TaskChip done={task.done} Icon={Icon} />
        <span
          className={cn(
            "line-clamp-2 min-w-0 flex-1 break-words pt-1",
            task.done && "text-muted-foreground line-through",
          )}
          lang={locale}
          title={task.title_i18n[locale]}
        >
          {task.title_i18n[locale]}
        </span>
      </label>
      {/* Row 2: duration + delete, on their own row so they never fight the
          title for width on narrow viewports. Indented to align under the
          title (chip width + its gap: size-8 + gap-2.5). */}
      <div className="flex items-center justify-end gap-1 ps-[2.625rem]">
        <span className="me-auto shrink-0 text-xs text-muted-foreground">{task.duration_min}m</span>
        <DeleteButton
          pending={deleteTask.isPending}
          ariaLabel={t("StudyPlan.deleteTask")}
          onConfirm={() => deleteTask.mutate({ date, taskId: task.id })}
        />
      </div>
    </motion.div>
  );
}

function PlanDayCard({ day, isToday }: { day: PlanDay; isToday: boolean }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const deleteDay = useDeleteDay();
  const doneCount = day.tasks.filter((t) => t.done).length;
  const pct = day.tasks.length > 0 ? (doneCount / day.tasks.length) * 100 : 0;
  const complete = day.tasks.length > 0 && doneCount === day.tasks.length;

  // Any day is manually collapsible via the chevron below — useful to tuck
  // away a day you're not working on right now without deleting it. A
  // finished day ALSO auto-collapses to a compact "done" summary on its own;
  // a brief pause after the LAST checkbox lands lets the user actually see
  // it complete before it tucks away. Un-checking a task on an
  // already-collapsed day re-expands it immediately, since editing a "done"
  // day is exactly when you need to see it again — this only fires on a
  // complete->incomplete transition, so it never fights a manual collapse
  // the user chose on a day that's still in progress.
  const [expanded, setExpanded] = useState(!complete);
  const wasComplete = useRef(complete);
  useEffect(() => {
    if (complete === wasComplete.current) return;
    wasComplete.current = complete;
    if (complete) {
      const timer = setTimeout(() => setExpanded(false), 1100);
      return () => clearTimeout(timer);
    }
    setExpanded(true);
  }, [complete]);
  const showBody = expanded;

  return (
    <motion.div
      layout
      initial={false}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={{ duration: 0.2 }}
      className={cn(
        // self-start: a grid row stretches every cell to match its tallest
        // sibling by default — without this, a collapsed "done" card (just a
        // header) still inherited the full height of a taller expanded
        // neighbour, leaving a large empty coloured box under it.
        "flex min-w-0 flex-col gap-2 self-start rounded-lg border p-3",
        // The tulsi border is a persistent "this day is done" cue that stays
        // even if the user re-expands it to review — a previous version only
        // applied it when collapsed, so re-expanding a complete day left BOTH
        // branches here false and the card with no border colour at all.
        complete ? "border-tulsi/25" : isToday ? "border-primary/40 ring-1 ring-primary/20" : "border-border",
        complete && !expanded ? "bg-tulsi/5" : "bg-card/50",
      )}
    >
      <div className="flex items-start gap-1">
        {/* The WHOLE header (not just the small chevron) toggles collapse —
            a real <button>, so it stays keyboard-accessible, sized for a
            comfortable tap target (min-h-11). Kept as a sibling of the
            delete button rather than nesting it (invalid — a button can't
            contain another interactive control) and generously separated
            from it, so collapsing a day and deleting one are never a
            mis-tap apart (a bare 2px gap between two 32px icon buttons
            previously made that easy to do by accident). */}
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          aria-expanded={expanded}
          aria-label={expanded ? t("StudyPlan.collapseDay") : t("StudyPlan.reviewDay")}
          className="flex min-h-11 min-w-0 flex-1 items-center justify-between gap-2 rounded-md py-1 ps-0.5 pe-2 text-left outline-none transition-colors hover:bg-muted/50 focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <span className="flex min-w-0 flex-wrap items-center gap-1.5">
            {complete && <CheckCircle2 className="size-4 shrink-0 text-tulsi-foreground" aria-hidden />}
            <span className="text-sm font-semibold" lang={locale}>
              {day.day_label_i18n[locale]}
            </span>
            {isToday && (
              <span className="rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold text-accent-foreground">
                {t("StudyPlan.today")}
              </span>
            )}
          </span>
          <span className="flex shrink-0 items-center gap-1.5">
            <span className={cn("text-xs font-medium tabular-nums", complete ? "text-tulsi-foreground" : "text-muted-foreground")}>
              {doneCount}/{day.tasks.length}
            </span>
            <ChevronDown
              className={cn(
                "size-3.5 shrink-0 transition-transform",
                expanded && "rotate-180",
                complete ? "text-tulsi-foreground" : "text-muted-foreground",
              )}
              aria-hidden
            />
          </span>
        </button>
        <DeleteButton
          pending={deleteDay.isPending}
          ariaLabel={t("StudyPlan.deleteDay")}
          onConfirm={() => deleteDay.mutate(day.date)}
        />
      </div>
      {showBody && (
        <>
          <p className="text-xs text-muted-foreground" lang={locale}>
            {day.focus_i18n[locale]}
          </p>
          {day.tasks.length > 0 && (
            <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full transition-[width] duration-500"
                style={{ width: `${pct}%`, backgroundColor: scoreBandColor(pct) }}
              />
            </div>
          )}
          <div className="flex min-w-0 flex-col gap-1.5">
            <AnimatePresence initial={false}>
              {day.tasks.map((task) => (
                <TaskRow key={task.id} task={task} date={day.date} />
              ))}
            </AnimatePresence>
            {day.tasks.length === 0 && (
              <p className="rounded-lg border border-dashed border-border px-2.5 py-2 text-center text-xs text-muted-foreground">
                {t("StudyPlan.dayCleared")}
              </p>
            )}
          </div>
        </>
      )}
    </motion.div>
  );
}

export function StudyPlanCard() {
  const { t } = useTranslation();
  const { data, isLoading } = useActivePlan();
  const stream = useStudyPlanStream();
  const { isGuest } = useAuth();
  const openPaywall = usePaywallStore((s) => s.openPaywall);
  const [hours, setHours] = useState(DEFAULT_HOURS);
  // Free-typed text for the input below, separate from the canonical numeric
  // state — see the fix + comment in practice/custom-test-builder.tsx. This
  // field had no `|| 1`-style clamp, but still force-displayed "0" the
  // instant the field was cleared (Number("") === 0), fighting a retype.
  const [hoursInput, setHoursInput] = useState(() => String(DEFAULT_HOURS));

  const plan = data?.plan ?? stream.plan;
  const canRegenerate = data?.can_regenerate_today ?? true;
  const today = istToday();

  const totalTasks = plan?.days.reduce((sum, d) => sum + d.tasks.length, 0) ?? 0;
  const doneTasks = plan?.days.reduce((sum, d) => sum + d.tasks.filter((t) => t.done).length, 0) ?? 0;
  const weekComplete = totalTasks > 0 && doneTasks === totalTasks;

  function generate() {
    if (isGuest) return openPaywall("generic");
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
                value={hoursInput}
                onChange={(e) => {
                  const raw = e.target.value;
                  setHoursInput(raw);
                  if (raw === "") return; // let the field go empty mid-edit instead of snapping to 0
                  const parsed = Number(raw);
                  if (!Number.isNaN(parsed)) setHours(parsed);
                }}
                onBlur={() => setHoursInput(String(hours))} // discard an empty/invalid typed value
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
          {stream.rateLimited && (
            <p className="text-sm text-muted-foreground">
              {stream.rateLimited.seconds !== null
                ? t("StudyPlan.rateLimited", { seconds: stream.rateLimited.seconds })
                : t("StudyPlan.rateLimitedGeneric")}
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
            <div className="flex flex-col gap-3">
              {!stream.isStreaming && (
                <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/30 px-3 py-2.5">
                  <ProgressRing value={doneTasks} max={totalTasks} size={40} stroke={4} />
                  <span className="text-sm font-medium">
                    {t("StudyPlan.weekProgress", { done: doneTasks, total: totalTasks })}
                  </span>
                </div>
              )}
              {weekComplete && (
                <div className="flex items-center gap-2 rounded-lg border border-tulsi/30 bg-tulsi/10 px-3 py-2 text-sm font-medium text-tulsi-foreground">
                  <PartyPopper className="size-4 shrink-0" aria-hidden />
                  {t("StudyPlan.weekComplete")}
                </div>
              )}
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                <AnimatePresence initial={false}>
                  {plan.days.map((day) => (
                    <PlanDayCard key={day.date} day={day} isToday={day.date === today} />
                  ))}
                </AnimatePresence>
              </div>
            </div>
          ) : null}
        </div>
      )}
    </SectionCard>
  );
}
