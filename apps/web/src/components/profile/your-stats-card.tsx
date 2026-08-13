import { useTranslation } from "react-i18next";
import { Brain, CalendarDays, Flame, Snowflake, type LucideIcon } from "lucide-react";
import type { Profile } from "@neev/shared";
import { SectionCard } from "@/components/ui-x/section-card";
import { Skeleton } from "@/components/ui-x/skeleton";

/**
 * "Your Stats" from docs/design/reference-1's profile page (panel 7): a card of
 * divided rows, each a small icon, a label, and the figure right-aligned.
 *
 * Every row comes from the profile the page already fetches — no extra request.
 * The reference's own rows (Courses Enrolled / Notes Saved / Flashcards
 * Revised) are its mock catalogue's vocabulary; these are the equivalents this
 * profile actually carries, and rows whose value is absent are dropped rather
 * than printed as a zero, which would read as a real score of nothing.
 */
function StatRow({
  icon: Icon,
  label,
  value,
  hint,
  tint = "bg-primary/15 text-primary",
}: {
  icon: LucideIcon;
  label: string;
  value: string | number;
  /** One line under the label, for a row whose name does not explain itself. */
  hint?: string;
  /** Semantic tint — streak/freezes are the gold "achievement" family, exam
   *  and target are neutral study-blue. Same assignments as the dashboard. */
  tint?: string;
}) {
  return (
    <li className="flex min-h-11 items-center gap-3 py-2.5">
      <span className={`flex size-8 shrink-0 items-center justify-center rounded-lg ${tint}`}>
        <Icon className="size-4" aria-hidden />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        {/* Only the label truncates. A hint that truncates teaches nothing, so
            it wraps instead. */}
        <span className="truncate text-sm">{label}</span>
        {hint && <span className="text-xs leading-snug text-muted-foreground">{hint}</span>}
      </span>
      {/* font-display is Inter 800 tabular — figures in a column must line up,
          and Poppins (the heading face) has no tabular figures at all. */}
      <span className="shrink-0 font-display text-lg tabular-nums">{value}</span>
    </li>
  );
}

export function YourStatsCard({ profile, isLoading }: { profile: Profile | undefined; isLoading: boolean }) {
  const { t } = useTranslation();

  if (isLoading && !profile) {
    return (
      <SectionCard title={t("Profile.yourStatsTitle")}>
        <div className="flex flex-col gap-3">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </div>
      </SectionCard>
    );
  }
  if (!profile) return null;

  return (
    <SectionCard title={t("Profile.yourStatsTitle")}>
      <ul className="flex flex-col divide-y divide-border">
        <StatRow
          icon={Flame}
          tint="bg-marigold/20 text-marigold-foreground ring-1 ring-marigold-foreground/25"
          label={t("Profile.statStreak")}
          value={t("Profile.statDays", { count: profile.streak_count })}
        />
        <StatRow
          icon={Snowflake}
          tint="bg-marigold/20 text-marigold-foreground ring-1 ring-marigold-foreground/25"
          label={t("Profile.statFreezes")}
          // "Streak freezes banked: 0" is unreadable without this — the number
          // means nothing unless you know a freeze is spent automatically to
          // cover a missed day, is earned every 7 days, caps at 2, and cannot
          // be bought. See daily/streak.ts.
          hint={t("Profile.statFreezesHint")}
          value={profile.streak_freezes}
        />
        {profile.next_exam && (
          <StatRow
            icon={CalendarDays}
            // Names the STAGE rather than saying "your exam": with both a
            // Prelims and a Mains date on the calendar, "282 days" alone does
            // not say which one it is counting to. Falls back to the old
            // generic label only if the stage is somehow absent.
            label={t(
              profile.next_exam.exam_stage === "mains"
                ? "Profile.statDaysToMains"
                : "Profile.statDaysToPrelims",
            )}
            value={t("Profile.statDays", { count: profile.next_exam.days_until })}
          />
        )}
        {profile.target_exam_year !== null && (
          <StatRow icon={Brain} label={t("Profile.statTargetYear")} value={profile.target_exam_year} />
        )}
      </ul>
    </SectionCard>
  );
}
